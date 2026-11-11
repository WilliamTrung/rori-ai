; Inno Setup — full Windows installer for GitHub Releases (build with ISCC on CI).
#define MyAppName "Rori AI"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "WilliamTrung"
#define MyAppURL "https://github.com/WilliamTrung/rori-ai"
#define MyAppExeName "RoriInstall.exe"

[Setup]
AppId={{E4B8F2A1-9C3D-4E5F-A6B7-C8D9E0F1A2B3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\..\artifacts\installer
OutputBaseFilename=RoriSetup-{#MyAppVersion}-win-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\artifacts\RoriInstall\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName} Install / Repair"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Code]
var
  BridgePage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  BridgePage := CreateInputQueryPage(wpSelectDir,
    'Gemini Web bridge (optional)', 'BYOK — llm-adaptor OpenAI-compatible /v1',
    'Leave blank to configure later with setup-rori-bridge.ps1');
  BridgePage.Add('Bridge URL (…/v1):', False);
  BridgePage.Add('API key (LLM_PLATFORM_OPENAI_API_KEY):', True);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Params: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    Params := '-InstallRoot "' + ExpandConstant('{app}') + '"';
    if BridgePage.Values[0] <> '' then
      Params := Params + ' -BridgeUrl "' + BridgePage.Values[0] + '"';
    if BridgePage.Values[1] <> '' then
      Params := Params + ' -ApiKey "' + BridgePage.Values[1] + '"';
    ShellExec('open', 'powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\post-install.ps1') + '" ' + Params,
      '', SW_SHOW, ewWaitUntilTerminated, ResultCode);
  end;
end;
