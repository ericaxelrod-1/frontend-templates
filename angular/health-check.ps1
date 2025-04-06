# Angular Application Health Check Script
Write-Host "Angular Application Health Check" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

# Check directories
Write-Host "`nChecking directory structure..." -ForegroundColor Yellow

$requiredDirs = @(
    "frontend",
    "frontend\src\app\shared\components\captcha",
    "frontend\src\app\shared\components\captcha\advanced",
    "frontend\src\assets\captcha\visual-reasoning",
    "frontend\src\assets\captcha\physical-world",
    "frontend\src\app\core\services"
)

foreach ($dir in $requiredDirs) {
    $dirPath = Join-Path -Path (Get-Location) -ChildPath $dir
    if (Test-Path -Path $dirPath -PathType Container) {
        Write-Host "✓ $dir exists" -ForegroundColor Green
    } else {
        Write-Host "✗ $dir does not exist" -ForegroundColor Red
        Write-Host "  Creating directory $dir..." -ForegroundColor Yellow
        New-Item -Path $dirPath -ItemType Directory -Force | Out-Null
    }
}

# Check required files
Write-Host "`nChecking required files..." -ForegroundColor Yellow

$requiredFiles = @(
    "frontend\src\app\shared\components\captcha\advanced\captcha-selector.component.ts",
    "frontend\src\app\shared\components\captcha\advanced\visual-reasoning-captcha.component.ts",
    "frontend\src\app\shared\components\captcha\advanced\physical-world-captcha.component.ts",
    "frontend\src\app\core\services\advanced-captcha.service.ts",
    "frontend\src\app\core\services\captcha.service.ts"
)

foreach ($file in $requiredFiles) {
    $filePath = Join-Path -Path (Get-Location) -ChildPath $file
    if (Test-Path -Path $filePath -PathType Leaf) {
        Write-Host "✓ $file exists" -ForegroundColor Green
    } else {
        Write-Host "✗ $file does not exist" -ForegroundColor Red
    }
}

# Check for CAPTCHA placeholder images
Write-Host "`nChecking CAPTCHA placeholder images..." -ForegroundColor Yellow

$requiredImages = @(
    "frontend\src\assets\captcha\visual-reasoning\pattern-sequence.jpg",
    "frontend\src\assets\captcha\visual-reasoning\count-objects.jpg",
    "frontend\src\assets\captcha\visual-reasoning\spatial-reasoning.jpg", 
    "frontend\src\assets\captcha\physical-world\weather.jpg",
    "frontend\src\assets\captcha\physical-world\time-of-day.jpg",
    "frontend\src\assets\captcha\physical-world\season.jpg"
)

foreach ($image in $requiredImages) {
    $imagePath = Join-Path -Path (Get-Location) -ChildPath $image
    if (Test-Path -Path $imagePath -PathType Leaf) {
        $fileSize = (Get-Item $imagePath).Length
        if ($fileSize -eq 0) {
            Write-Host "⚠ $image exists but is empty (0 bytes)" -ForegroundColor Yellow
            # Create a non-empty placeholder image
            Set-Content -Path $imagePath -Value "Placeholder Image" -Force
            Write-Host "  Created placeholder content for $image" -ForegroundColor Yellow
        } else {
            Write-Host "✓ $image exists ($fileSize bytes)" -ForegroundColor Green
        }
    } else {
        Write-Host "✗ $image does not exist" -ForegroundColor Red
        # Create a placeholder image
        New-Item -Path $imagePath -ItemType File -Force | Out-Null
        Set-Content -Path $imagePath -Value "Placeholder Image" -Force
        Write-Host "  Created placeholder $image" -ForegroundColor Yellow
    }
}

# Check Angular application status
Write-Host "`nApplication Status Check" -ForegroundColor Yellow
Write-Host "---------------------" -ForegroundColor Yellow

if (Test-Path -Path "frontend\angular.json" -PathType Leaf) {
    Write-Host "✓ Angular configuration found" -ForegroundColor Green
} else {
    Write-Host "✗ No angular.json found - application may be misconfigured" -ForegroundColor Red
}

# Display helpful information
Write-Host "`nNext Steps" -ForegroundColor Cyan
Write-Host "==========" -ForegroundColor Cyan
Write-Host "1. Run the application with: cd frontend && ng serve" -ForegroundColor White
Write-Host "2. If there are errors, check the console output for specific issues" -ForegroundColor White
Write-Host "3. Navigate to http://localhost:4200/ to access the application" -ForegroundColor White
Write-Host "4. To test the CAPTCHA functionality, go to http://localhost:4200/login" -ForegroundColor White

Write-Host "`nHealth check complete!" -ForegroundColor Green 