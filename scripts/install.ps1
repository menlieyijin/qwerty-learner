# 定义函数
function Test-CommandInstalled([string]$CommandName) {
    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        return $true
    }
    else {
        return $false
    }
}

$location = Get-Location

# 检测Node命令是否存在
if (!(Test-CommandInstalled node)) {
    Write-Host "未检测到nodejs环境，尝试使用winget安装..."
    # 检测winget是否存在
    if (!(Test-CommandInstalled winget)) {
        Write-Host "未检测到winget，无法完成安装，请检测系统版本，或尝试安装winget:https://www.microsoft.com/p/app-installer/9nblggh4nns1#activetab=pivot:overviewtab"
    }
    else {
        winget install OpenJS.Nodejs --silent
        Write-Host "nodejs 安装完成"
    }
}else{
    Write-Host "已安装nodejs!"
    Set-Location ..
    Write-Host "开始安装依赖..."
    # 只允许 npm ci：锁文件与 package.json 不一致时应当报错，而不是悄悄重写依赖树
    if (!(Test-Path "package-lock.json")) {
        Write-Host "缺少 package-lock.json，拒绝安装（请先在仓库根执行 npm install 并提交锁文件）"
        Set-Location $location
        exit 1
    }
    npm ci --registry=https://registry.npmmirror.com
    if ($LASTEXITCODE -ne 0) {
        Write-Host "依赖安装失败，请检查 Node 版本是否满足 engines（node >=22.12 <23）与网络"
        Set-Location $location
        exit 1
    }
    Write-Host "依赖安装完成，启动程序..."
    
    Start-Job -ScriptBlock {
        Start-Sleep 4
        Start-Process http://localhost:5173/
    } | Out-Null
    npm run start
    Set-Location $location
}
