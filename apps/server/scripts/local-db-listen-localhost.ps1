# Base de datos local de desarrollo (F9): PostgreSQL solo escucha en localhost (127.0.0.1 y ::1).
# Hace una copia de postgresql.conf, cambia listen_addresses a 'localhost' y reinicia el servicio.
# Necesita permisos de administrador: se ejecuta con
#   Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File <este archivo>'
# No toca pg_hba.conf ni ningún otro ajuste.
param(
    [string]$DataDir = 'C:\Program Files\PostgreSQL\18\data',
    [string]$Service = 'postgresql-x64-18'
)
$ErrorActionPreference = 'Stop'
try {
    $conf = Join-Path $DataDir 'postgresql.conf'
    $backup = "$conf.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $conf -Destination $backup
    Write-Host "Copia: $backup"

    $text = [IO.File]::ReadAllText($conf)
    $pattern = '(?m)^[ \t]*listen_addresses[ \t]*=[^\r\n]*'
    $found = [regex]::Matches($text, $pattern)
    if ($found.Count -ne 1) { throw "Se esperaba una sola linea activa de listen_addresses y hay $($found.Count)." }
    $text = [regex]::Replace($text, $pattern, "listen_addresses = 'localhost'`t`t# F9: solo conexiones locales (antes '*')")
    # Sin BOM: PostgreSQL no lo admite al principio de postgresql.conf.
    [IO.File]::WriteAllText($conf, $text, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "listen_addresses = 'localhost'"

    Restart-Service -Name $Service
    Write-Host "Servicio $Service reiniciado: $((Get-Service -Name $Service).Status)"
    Start-Sleep -Seconds 2
    exit 0
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    Read-Host 'Pulsa Enter para cerrar'
    exit 1
}
