param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\Assets')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

function New-RoundedRectanglePath {
    param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius)
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-IconPngBytes {
    param([int]$Size)
    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([System.Drawing.Color]::Transparent)

        $margin = $Size * 0.047
        $side = $Size - ($margin * 2)
        $radius = $Size * 0.22
        $backgroundPath = New-RoundedRectanglePath $margin $margin $side $side $radius
        $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
            [System.Drawing.PointF]::new($margin, $margin),
            [System.Drawing.PointF]::new($Size - $margin, $Size - $margin),
            [System.Drawing.ColorTranslator]::FromHtml('#1A73E8'),
            [System.Drawing.ColorTranslator]::FromHtml('#0B57D0')
        )
        try { $graphics.FillPath($gradient, $backgroundPath) } finally { $gradient.Dispose(); $backgroundPath.Dispose() }

        $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
        try {
            $speaker = [System.Drawing.PointF[]]@(
                [System.Drawing.PointF]::new($Size * 0.262, $Size * 0.418),
                [System.Drawing.PointF]::new($Size * 0.414, $Size * 0.418),
                [System.Drawing.PointF]::new($Size * 0.574, $Size * 0.293),
                [System.Drawing.PointF]::new($Size * 0.650, $Size * 0.293),
                [System.Drawing.PointF]::new($Size * 0.650, $Size * 0.707),
                [System.Drawing.PointF]::new($Size * 0.574, $Size * 0.707),
                [System.Drawing.PointF]::new($Size * 0.414, $Size * 0.582),
                [System.Drawing.PointF]::new($Size * 0.262, $Size * 0.582)
            )
            $graphics.FillPolygon($white, $speaker)
        } finally { $white.Dispose() }

        $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [Math]::Max(1.5, $Size * 0.047))
        try {
            $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $graphics.DrawArc($pen, $Size * 0.586, $Size * 0.355, $Size * 0.172, $Size * 0.290, -54, 108)
            $graphics.DrawArc($pen, $Size * 0.598, $Size * 0.273, $Size * 0.285, $Size * 0.454, -54, 108)
        } finally { $pen.Dispose() }

        $stream = [System.IO.MemoryStream]::new()
        try {
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            return $stream.ToArray()
        } finally { $stream.Dispose() }
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = foreach ($size in $sizes) {
    [pscustomobject]@{ Size = $size; Bytes = [byte[]](New-IconPngBytes $size) }
}

$iconPath = Join-Path $resolvedOutput 'AudioBridge.ico'
$file = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = [System.IO.BinaryWriter]::new($file)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$images.Count)
    $offset = 6 + (16 * $images.Count)
    foreach ($image in $images) {
        $dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$image.Bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $image.Bytes.Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
} finally {
    $writer.Dispose()
    $file.Dispose()
}

[System.IO.File]::WriteAllBytes((Join-Path $resolvedOutput 'AudioBridge.png'), (New-IconPngBytes 256))
Write-Output $iconPath
