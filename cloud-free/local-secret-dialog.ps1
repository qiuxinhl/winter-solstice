param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('token', 'result')]
  [string]$Mode,
  [string]$WindowTitle = '填写 Supabase 管理令牌',
  [string]$Purpose = '只在内存中用于新建免费小屋，不会保存到文件、日志或聊天。',
  [string]$ConfirmText = '开始开通'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CouplePromptVisibility {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@

  $form = New-Object System.Windows.Forms.Form
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
  $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
  $form.TopMost = $true
  $form.Add_Shown({
    [void][CouplePromptVisibility]::ShowWindow($form.Handle, 5)
    [void][CouplePromptVisibility]::SetForegroundWindow($form.Handle)
    $form.Activate()
  })

  if ($Mode -eq 'token') {
    $form.Text = $WindowTitle
    $form.ClientSize = New-Object System.Drawing.Size(610, 215)
    $description = New-Object System.Windows.Forms.Label
    $description.Location = New-Object System.Drawing.Point(20, 18)
    $description.Size = New-Object System.Drawing.Size(570, 65)
    $description.Text = "请粘贴 Supabase Personal Access Token。`r`n$Purpose"
    $form.Controls.Add($description)

    $tokenBox = New-Object System.Windows.Forms.TextBox
    $tokenBox.Location = New-Object System.Drawing.Point(20, 88)
    $tokenBox.Size = New-Object System.Drawing.Size(570, 28)
    $tokenBox.UseSystemPasswordChar = $true
    $tokenBox.MaxLength = 4096
    $form.Controls.Add($tokenBox)

    $confirm = New-Object System.Windows.Forms.Button
    $confirm.Text = $ConfirmText
    $confirm.Location = New-Object System.Drawing.Point(355, 155)
    $confirm.Size = New-Object System.Drawing.Size(110, 36)
    $confirm.Add_Click({
      if ([string]::IsNullOrWhiteSpace($tokenBox.Text)) { return }
      $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
      $form.Close()
    })
    $form.Controls.Add($confirm)
    $form.AcceptButton = $confirm

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = '取消'
    $cancel.Location = New-Object System.Drawing.Point(480, 155)
    $cancel.Size = New-Object System.Drawing.Size(110, 36)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($cancel)
    $form.CancelButton = $cancel
    $form.Add_Shown({ [void]$tokenBox.Focus() })

    $choice = $form.ShowDialog()
    if ($choice -eq [System.Windows.Forms.DialogResult]::OK) {
      # stdout is a private child-process pipe captured by Node, never inherited.
      $answer = @{ ok = $true; value = $tokenBox.Text }
      [Console]::Out.Write(($answer | ConvertTo-Json -Compress))
      $answer.value = $null
    } else {
      [Console]::Out.Write('{"ok":false}')
    }
    $tokenBox.Clear()
  } else {
    # Read credentials from stdin; never put them in process arguments or files.
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($payload.password.Length -ne 64 -or
      -not $payload.invitation.StartsWith('https://qiuxinhl.github.io/winter-solstice/#room=')) {
      throw 'Invalid local payload'
    }
    $form.Text = '免费小屋已准备好'
    $form.ClientSize = New-Object System.Drawing.Size(760, 450)
    $notice = New-Object System.Windows.Forms.Label
    $notice.Location = New-Object System.Drawing.Point(20, 18)
    $notice.Size = New-Object System.Drawing.Size(720, 62)
    $notice.Text = "请保存口令和私人邀请链接，再关闭窗口。它们不会写入文件或日志。`r`n邀请链接可直接登录小屋，只分享给伴侣；程序不会自动发送或打开链接。"
    $form.Controls.Add($notice)

    $passwordLabel = New-Object System.Windows.Forms.Label
    $passwordLabel.Text = '小屋口令'
    $passwordLabel.Location = New-Object System.Drawing.Point(20, 90)
    $passwordLabel.Size = New-Object System.Drawing.Size(150, 25)
    $form.Controls.Add($passwordLabel)
    $passwordBox = New-Object System.Windows.Forms.TextBox
    $passwordBox.Location = New-Object System.Drawing.Point(20, 120)
    $passwordBox.Size = New-Object System.Drawing.Size(590, 60)
    $passwordBox.Multiline = $true
    $passwordBox.ReadOnly = $true
    $passwordBox.Text = $payload.password
    $form.Controls.Add($passwordBox)
    $copyPassword = New-Object System.Windows.Forms.Button
    $copyPassword.Text = '复制口令'
    $copyPassword.Location = New-Object System.Drawing.Point(625, 120)
    $copyPassword.Size = New-Object System.Drawing.Size(115, 36)
    $copyPassword.Add_Click({ [System.Windows.Forms.Clipboard]::SetText($passwordBox.Text) })
    $form.Controls.Add($copyPassword)

    $invitationLabel = New-Object System.Windows.Forms.Label
    $invitationLabel.Text = '私人邀请链接'
    $invitationLabel.Location = New-Object System.Drawing.Point(20, 197)
    $invitationLabel.Size = New-Object System.Drawing.Size(180, 25)
    $form.Controls.Add($invitationLabel)
    $invitationBox = New-Object System.Windows.Forms.TextBox
    $invitationBox.Location = New-Object System.Drawing.Point(20, 228)
    $invitationBox.Size = New-Object System.Drawing.Size(590, 135)
    $invitationBox.Multiline = $true
    $invitationBox.ReadOnly = $true
    $invitationBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
    $invitationBox.Text = $payload.invitation
    $form.Controls.Add($invitationBox)
    $copyInvitation = New-Object System.Windows.Forms.Button
    $copyInvitation.Text = '复制邀请链接'
    $copyInvitation.Location = New-Object System.Drawing.Point(625, 228)
    $copyInvitation.Size = New-Object System.Drawing.Size(115, 36)
    $copyInvitation.Add_Click({ [System.Windows.Forms.Clipboard]::SetText($invitationBox.Text) })
    $form.Controls.Add($copyInvitation)

    $close = New-Object System.Windows.Forms.Button
    $close.Text = '关闭窗口'
    $close.Location = New-Object System.Drawing.Point(625, 390)
    $close.Size = New-Object System.Drawing.Size(115, 36)
    $close.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Controls.Add($close)
    $form.AcceptButton = $close
    $null = $form.ShowDialog()
    $passwordBox.Clear()
    $invitationBox.Clear()
    $payload = $null
    [Console]::Out.Write('{"ok":true}')
  }
  $form.Dispose()
  exit 0
} catch {
  # Do not print $_, exception messages, call stacks, stdin, or control contents.
  [Console]::Error.Write('Local dialog did not complete.')
  exit 1
}
