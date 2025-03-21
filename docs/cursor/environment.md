# Command Environment Guidelines

This document provides guidelines for Claude when executing commands in different environments. Following these guidelines ensures commands work properly across platforms and maintains platform-independent code.

## The Goal

Guide Claude on which commands should and should not be used in different environments. The goal is to prevent executing commands that are incompatible with the user's operating system (e.g., running Linux commands in a Windows environment).

## Getting Started

### Gathering System Information

To create a customized environment rule for your system, first gather information about your specific environment using the commands below for your operating system.

#### Windows System Information Commands
```powershell
# Get OS information
Get-ComputerInfo -Property WindowsProductName, WindowsVersion, OsHardwareAbstractionLayer

# Get PowerShell version
$PSVersionTable

# Get current directory
Get-Location

# Get environment variables
Get-ChildItem Env:

# Get system hardware information
Get-CimInstance Win32_ComputerSystem

# Get processor information
Get-CimInstance Win32_Processor
```

#### macOS System Information Commands
```bash
# Get OS information
sw_vers
uname -a

# Get shell information
echo $SHELL
$SHELL --version

# Get current directory
pwd

# Get environment variables
env

# Get system hardware information
system_profiler SPHardwareDataType

# Get processor information
sysctl -n machdep.cpu.brand_string
```

#### Linux System Information Commands
```bash
# Get OS information
cat /etc/os-release
uname -a

# Get shell information
echo $SHELL
$SHELL --version

# Get current directory
pwd

# Get environment variables
env

# Get system information
lscpu
free -h
df -h
```

#### Docker System Information Commands
```bash
# Inside container - Get OS information
cat /etc/os-release
uname -a

# Inside container - Get environment variables
env

# Inside container - Get system information
df -h
free -h
```

### Creating Your Environment Rule

After gathering system information, follow these steps:

1. **Select the rule template** that matches your operating system from the sections below
2. **Copy the terminal output** from running the system information commands and add it to a Cursor chat with Claude
3. **Copy the rule template** for your OS and add it to the same Cursor chat
4. **Ask Claude** to edit the template with your actual system configuration information
5. **Let Claude generate** an environment.mdc file in the `.cursor/rules` directory

Example prompt for Claude:
```
I've run the system information commands for my OS. Here's the output:

[PASTE TERMINAL OUTPUT HERE]

Here's the rule template I want to use:

[PASTE RULE TEMPLATE HERE]

Please edit this template with my actual system information and create a file at .cursor/rules/environment.mdc with the customized content.
```

## Rule Templates

### Windows Environment Rule

Copy and paste this entire template into `.cursor/rules/windows-environment.mdc`:

```
---
description: "Windows-specific command guidelines to ensure proper syntax"
globs: ["**/*"]
tags: ["windows", "powershell"]
priority: 4
---

# Windows Command Guidelines

## Environment Detection
- OS: Windows 10/11
- Shell: PowerShell
- Path Format: C:\path\to\directory

## Command Requirements
- Use PowerShell commands and syntax
- Use backslashes for paths (C:\Users\name)
- Use semicolons for command chaining
- Use $env: prefix for environment variables

## Common Commands
```powershell
# File operations
New-Item -ItemType Directory -Path $env:USERPROFILE\Documents\NewFolder
Copy-Item -Path source.txt -Destination target.txt
Get-Content file.txt

# Process management
Get-Process
Stop-Process -Name "processname"

# System information
Get-ComputerInfo
```

## Incorrect Syntax to Avoid
```bash
# Don't use forward slashes for paths
cd /c/Users/username/Documents

# Don't use && for command chaining
mkdir test && cd test

# Don't use Unix-style environment variables
echo $HOME
```
```

### macOS Environment Rule

Copy and paste this entire template into `.cursor/rules/macos-environment.mdc`:

```
---
description: "macOS-specific command guidelines to ensure proper syntax"
globs: ["**/*"]
tags: ["macos", "bash", "zsh"]
priority: 4
---

# macOS Command Guidelines

## Environment Detection
- OS: macOS
- Shell: Bash/Zsh
- Path Format: /path/to/directory

## Command Requirements
- Use Bash/Zsh commands and syntax
- Use forward slashes for paths (/Users/name)
- Use && or ; for command chaining
- Use $ prefix for environment variables

## Common Commands
```bash
# File operations
mkdir -p ~/Documents/NewFolder
cp source.txt target.txt
cat file.txt

# Process management
ps aux | grep process_name
kill process_id

# System information
sw_vers
system_profiler SPHardwareDataType
```

## Incorrect Syntax to Avoid
```powershell
# Don't use backslashes for paths
cd ~\Documents

# Don't use PowerShell cmdlets
Get-ChildItem

# Don't use PowerShell environment variables
$env:HOME
```
```

### Linux Environment Rule

Copy and paste this entire template into `.cursor/rules/linux-environment.mdc`:

```
---
description: "Linux-specific command guidelines to ensure proper syntax"
globs: ["**/*"]
tags: ["linux", "bash", "ubuntu", "debian", "fedora"]
priority: 4
---

# Linux Command Guidelines

## Environment Detection
- OS: Linux (Ubuntu/Debian/Fedora/etc.)
- Shell: Bash
- Path Format: /path/to/directory

## Command Requirements
- Use Bash commands and syntax
- Use forward slashes for paths (/home/user)
- Use && or ; for command chaining
- Use $ prefix for environment variables

## Common Commands
```bash
# File operations
mkdir -p ~/documents/new_folder
cp source.txt target.txt
cat file.txt

# Process management
ps aux | grep process_name
kill process_id

# System information
cat /etc/os-release
lscpu
free -h
```

## Incorrect Syntax to Avoid
```powershell
# Don't use backslashes for paths
cd \home\username\documents

# Don't use PowerShell cmdlets
Get-ChildItem

# Don't use PowerShell environment variables
$env:HOME
```
```

### Docker Environment Rule

Copy and paste this entire template into `.cursor/rules/docker-environment.mdc`:

```
---
description: "Docker container command guidelines to ensure proper syntax"
globs: ["Dockerfile", "docker-compose.yml", "**/*.dockerfile"]
tags: ["docker", "container", "bash"]
priority: 4
---

# Docker Command Guidelines

## Environment Detection
- Container OS: Usually Linux-based
- Shell: Bash
- Path Format: /path/to/directory

## Command Requirements
- Use Bash commands and syntax inside containers
- Use forward slashes for paths (/app)
- Use && or ; for command chaining
- Use $ prefix for environment variables

## Common Commands
```bash
# Docker host commands
docker build -t my-image .
docker run -v $(pwd):/app -p 3000:3000 my-image
docker-compose up -d

# Commands inside container
cd /app && npm install
ls -la /app/src
env | grep API_
```

## Incorrect Syntax to Avoid
```powershell
# Don't use PowerShell syntax inside Linux containers
cd \app
Get-ChildItem
$env:PATH
```
```

## Cross-Platform Considerations

### Windows 10/11

- **Use PowerShell syntax** for commands
- **Commands must not use:**
  - `&&` for command chaining (use `;` instead)
  - `/` for directory paths in commands (use `\` instead)
  - Unix-specific environment variable syntax 
- **Commands must use:**
  - `;` for command chaining
  - `\` for directory paths in commands
  - `$env:` prefix for environment variables (e.g., `$env:USERPROFILE`)
- **Example correct commands:**
  ```powershell
  cd C:\Users\username\Documents; Get-ChildItem
  New-Item -ItemType Directory -Path $env:USERPROFILE\Documents\NewFolder
  ```
- **Example incorrect commands:**
  ```bash
  cd /c/Users/username/Documents && ls
  mkdir $HOME/Documents/NewFolder
  ```

### macOS

- **Use Bash/Zsh syntax** for commands
- **Commands must use:**
  - `&&` or `;` for command chaining
  - `/` for directory paths
  - `$` prefix for environment variables
- **Example correct commands:**
  ```bash
  cd ~/Documents && ls
  mkdir $HOME/Documents/NewFolder
  ```
- **Example incorrect commands:**
  ```powershell
  cd ~\Documents; Get-ChildItem
  New-Item -ItemType Directory -Path $env:HOME\Documents\NewFolder
  ```

### Linux Distributions (Ubuntu, Debian, Fedora, etc.)

- **Use Bash syntax** for commands
- **Commands must use:**
  - `&&` or `;` for command chaining
  - `/` for directory paths
  - `$` prefix for environment variables
- **Example correct commands:**
  ```bash
  cd /home/username/documents && ls -la
  mkdir -p $HOME/documents/new_folder
  ```
- **Example incorrect commands:**
  ```powershell
  cd \home\username\documents; Get-ChildItem
  $env:HOME/documents/new_folder | Out-Null
  ```

### Docker Containers

- **Default to Bash/Linux syntax** unless specified otherwise
- **Be aware of container-specific paths** and permissions
- **When running Docker commands:**
  - Use appropriate Docker CLI syntax
  - Consider mapping volumes carefully
- **Example correct commands:**
  ```bash
  # Running from host
  docker run -v $(pwd):/app -p 3000:3000 my-image
  
  # Running inside container
  cd /app && npm install
  ```
- **Example incorrect commands:**
  ```powershell
  # Running inside Linux container with Windows commands
  cd \app; Get-ChildItem
  ```

## Platform-Independent Code Requirements

### File Types to Avoid Creating

Unless specifically instructed, avoid creating platform-specific executable or script files:

- `.exe` - Windows executable
- `.bat` - Windows batch files
- `.ps1` - PowerShell scripts
- `.sh` - Shell scripts
- `.command` - macOS command files
- `.app` - macOS application bundles
- `.msi` - Windows installer packages

### Preferred Platform-Independent Alternatives

- Use interpreted languages with cross-platform compatibility:
  - Python (`.py`)
  - JavaScript/Node.js (`.js`)
  - Ruby (`.rb`)
  - Java (`.java`)
  
- For configuration:
  - YAML (`.yml`, `.yaml`)
  - JSON (`.json`)
  - TOML (`.toml`)
  - INI (`.ini`)

### Command Detection and Auto-Adaptation

Claude should detect the user's platform from context or by asking explicitly before providing commands. Default to platform-agnostic instructions when possible.

## Environment Detection

When a command's environment is unclear, Claude should:

1. Check for clues in the conversation (e.g., path formats, command responses)
2. Ask the user to specify their environment
3. Provide multiple command options for different platforms if appropriate

By following these guidelines, Claude can help ensure commands are compatible with the user's system and maintain platform independence. 