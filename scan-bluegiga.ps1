param(
    [string]$Port = 'AUTO',
    [int]$DurationMs = 2500
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-Exact {
    param(
        [System.IO.Ports.SerialPort]$SerialPort,
        [int]$Count,
        [int]$TimeoutMs = 600
    )

    $buffer = New-Object byte[] $Count
    $offset = 0
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($offset -lt $Count) {
        if ($watch.ElapsedMilliseconds -gt $TimeoutMs) {
            return $null
        }
        $available = $SerialPort.BytesToRead
        if ($available -le 0) {
            Start-Sleep -Milliseconds 15
            continue
        }
        $readCount = [Math]::Min($available, $Count - $offset)
        $read = $SerialPort.Read($buffer, $offset, $readCount)
        if ($read -gt 0) {
            $offset += $read
        }
    }
    return $buffer
}

function Send-Bgapi {
    param(
        [System.IO.Ports.SerialPort]$SerialPort,
        [byte[]]$Bytes
    )

    $SerialPort.Write($Bytes, 0, $Bytes.Length)
    Start-Sleep -Milliseconds 40
}

function Parse-AdvertisementData {
    param([byte[]]$Data)

    if (-not $Data) {
        $Data = [byte[]]@()
    }

    $result = [ordered]@{
        localName = ''
        manufacturerData = ''
        serviceData = ''
        serviceDataUuid = ''
        serviceDataValue = ''
        measurement = ''
        rawData = ([System.BitConverter]::ToString($Data)).Replace('-', '')
    }

    $index = 0
    while ($index -lt $Data.Length) {
        $length = [int]$Data[$index]
        if ($length -le 0) { break }
        $endIndex = $index + $length
        if ($endIndex -ge $Data.Length + 1) { break }
        $type = $Data[$index + 1]
        $valueStart = $index + 2
        $valueLength = $length - 1
        if ($valueLength -lt 0) { break }
        $valueBytes = if ($valueLength -gt 0) { [byte[]]$Data[$valueStart..($valueStart + $valueLength - 1)] } else { [byte[]]@() }

        switch ($type) {
            0x08 { $result.localName = [System.Text.Encoding]::ASCII.GetString($valueBytes) }
            0x09 { $result.localName = [System.Text.Encoding]::ASCII.GetString($valueBytes) }
            0x16 {
                $result.serviceData = ([System.BitConverter]::ToString($valueBytes)).Replace('-', '')
                if ($valueBytes.Length -ge 2) {
                    $uuidBytes = [byte[]]$valueBytes[0..1]
                    $result.serviceDataUuid = (($uuidBytes[1], $uuidBytes[0]) | ForEach-Object { '{0:X2}' -f $_ }) -join ''
                    if ($valueBytes.Length -gt 2) {
                        $serviceValueBytes = [byte[]]$valueBytes[2..($valueBytes.Length - 1)]
                        $result.serviceDataValue = ([System.BitConverter]::ToString($serviceValueBytes)).Replace('-', '')
                        if ($result.serviceDataUuid -eq '5000' -and $serviceValueBytes.Length -ge 4) {
                            $measurementRaw = [BitConverter]::ToInt32($serviceValueBytes, 0)
                            $measurementValue = $measurementRaw / 1000.0
                            $result.measurement = ('{0:0.####}' -f $measurementValue)
                        }
                    }
                }
            }
            0xFF { $result.manufacturerData = ([System.BitConverter]::ToString($valueBytes)).Replace('-', '') }
        }

        $index += ($length + 1)
    }

    return $result
}

function Find-BluegigaPort {
    try {
        $ports = Get-CimInstance Win32_SerialPort -ErrorAction Stop |
            Where-Object { $_.Name -match 'Bluegiga|Bluetooth Low Energy' -or $_.Description -match 'Bluegiga|Bluetooth Low Energy' } |
            Select-Object -ExpandProperty DeviceID
        if ($ports) {
            return ($ports | Select-Object -First 1)
        }
    } catch {}

    $fallbackPorts = [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object
    return $fallbackPorts | Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($Port) -or $Port -eq 'AUTO') {
    $Port = Find-BluegigaPort
}

if ([string]::IsNullOrWhiteSpace($Port)) {
    throw 'No Bluegiga-compatible serial port could be detected on this machine.'
}

$serialPort = [System.IO.Ports.SerialPort]::new($Port, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$serialPort.Handshake = [System.IO.Ports.Handshake]::None
$serialPort.ReadTimeout = 150
$serialPort.WriteTimeout = 500
$serialPort.DtrEnable = $true
$serialPort.RtsEnable = $true

$devices = @{}

try {
    $serialPort.Open()
    $serialPort.DiscardInBuffer()
    $serialPort.DiscardOutBuffer()

    Send-Bgapi -SerialPort $serialPort -Bytes ([byte[]](0x00,0x00,0x06,0x04))
    Send-Bgapi -SerialPort $serialPort -Bytes ([byte[]](0x00,0x05,0x06,0x07,0xC8,0x00,0xC8,0x00,0x01))
    Send-Bgapi -SerialPort $serialPort -Bytes ([byte[]](0x00,0x01,0x06,0x02,0x02))

    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt $DurationMs) {
        $header = Read-Exact -SerialPort $serialPort -Count 4 -TimeoutMs 200
        if (-not $header) { continue }

        $payloadLength = (([int]($header[0] -band 0x07)) -shl 8) + [int]$header[1]
        $classId = [int]$header[2]
        $methodId = [int]$header[3]
        $isEvent = (($header[0] -band 0x80) -ne 0)

        $payload = if ($payloadLength -gt 0) {
            Read-Exact -SerialPort $serialPort -Count $payloadLength -TimeoutMs 400
        } else {
            [byte[]]@()
        }
        if ($payloadLength -gt 0 -and -not $payload) { continue }

        if (-not $isEvent -or $classId -ne 0x06 -or $methodId -ne 0x00) { continue }
        if ($payload.Length -lt 11) { continue }

        $rssiByte = [int]$payload[0]
        $rssi = if ($rssiByte -gt 127) { $rssiByte - 256 } else { $rssiByte }
        $packetType = [int]$payload[1]
        $senderBytes = [byte[]]$payload[2..7]
        [array]::Reverse($senderBytes)
        $macAddress = ($senderBytes | ForEach-Object { '{0:X2}' -f $_ }) -join ''
        $addressType = [int]$payload[8]
        $bond = [int]$payload[9]
        $dataLength = [int]$payload[10]
        $advData = if ($dataLength -gt 0 -and $payload.Length -ge (11 + $dataLength)) {
            [byte[]]$payload[11..(11 + $dataLength - 1)]
        } elseif ($payload.Length -gt 11) {
            [byte[]]$payload[11..($payload.Length - 1)]
        } else {
            [byte[]]@()
        }
        $parsed = Parse-AdvertisementData -Data $advData
        $displayName = if ($parsed.localName) { $parsed.localName } else { $macAddress }

        $devices[$macAddress] = [ordered]@{
            name = $displayName
            macAddress = $macAddress
            rssi = $rssi
            packetType = $packetType
            addressType = $addressType
            bond = $bond
            localName = $parsed.localName
            manufacturerData = $parsed.manufacturerData
            serviceData = $parsed.serviceData
            serviceDataUuid = $parsed.serviceDataUuid
            serviceDataValue = $parsed.serviceDataValue
            measurement = $parsed.measurement
            rawData = $parsed.rawData
            scannedVia = 'Bluegiga BLED112'
        }
    }
}
finally {
    try {
        if ($serialPort.IsOpen) {
            Send-Bgapi -SerialPort $serialPort -Bytes ([byte[]](0x00,0x00,0x06,0x04))
        }
    } catch {}
    try {
        if ($serialPort.IsOpen) { $serialPort.Close() }
    } catch {}
    $serialPort.Dispose()
}

[pscustomobject]@{
    ok = $true
    port = $Port
    scannedAt = [DateTime]::UtcNow.ToString('o')
    devices = @($devices.Values)
} | ConvertTo-Json -Depth 6 -Compress
