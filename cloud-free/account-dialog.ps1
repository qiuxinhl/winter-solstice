$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QxnnAccountWindow {
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
  [Windows.Forms.Application]::EnableVisualStyles()
  $form=New-Object Windows.Forms.Form
  $form.Text='QXNN · 设置两个人的账号'
  $form.StartPosition='CenterScreen'
  $form.ClientSize=New-Object Drawing.Size(640,560)
  $form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
  $form.TopMost=$true
  $notice=New-Object Windows.Forms.Label
  $notice.SetBounds(24,18,590,70)
  $notice.Text="无需提供邮箱。账号将分别绑定你们的留言身份。`r`n密码和管理令牌只在本次操作内存中使用，不写入文件、聊天或仓库。"
  $form.Controls.Add($notice)
  $fields=@{}
  $names=@('我的账号','我的密码','对方的账号','对方的密码','Supabase 管理令牌')
  for($i=0;$i -lt $names.Count;$i++) {
    $label=New-Object Windows.Forms.Label
    $label.SetBounds(24,(94+$i*67),590,22)
    $label.Text=$names[$i]
    $box=New-Object Windows.Forms.TextBox
    $box.SetBounds(24,(118+$i*67),590,28)
    $box.MaxLength=if($i -eq 4){4096}else{128}
    $box.UseSystemPasswordChar=($i -in @(1,3,4))
    $fields[$i]=$box
    $form.Controls.AddRange(@($label,$box))
  }
  $link=New-Object Windows.Forms.LinkLabel
  $link.SetBounds(24,435,590,24)
  $link.Text='打开管理令牌页面（用于升级现有小屋权限）'
  $link.Add_LinkClicked({Start-Process 'https://supabase.com/dashboard/account/tokens'})
  $form.Controls.Add($link)
  $help=New-Object Windows.Forms.Label
  $help.SetBounds(24,464,590,38)
  $help.Text='账号为2至24个字，可用中文、字母、数字、下划线和短横线；密码至少8位。请自行记住两套账号密码。'
  $form.Controls.Add($help)
  $go=New-Object Windows.Forms.Button
  $go.SetBounds(375,510,115,34)
  $go.Text='设置账号'
  $go.Add_Click({
    if($fields[0].Text.Trim().Length -lt 2 -or $fields[2].Text.Trim().Length -lt 2 -or $fields[1].Text.Length -lt 8 -or $fields[3].Text.Length -lt 8 -or [String]::IsNullOrWhiteSpace($fields[4].Text)) {
      [void][Windows.Forms.MessageBox]::Show('请完整填写两套账号密码和管理令牌，密码至少8位。','还差一点');return
    }
    $form.DialogResult=[Windows.Forms.DialogResult]::OK;$form.Close()
  })
  $cancel=New-Object Windows.Forms.Button
  $cancel.SetBounds(505,510,110,34);$cancel.Text='取消'
  $cancel.DialogResult=[Windows.Forms.DialogResult]::Cancel
  $form.Controls.AddRange(@($go,$cancel));$form.AcceptButton=$go;$form.CancelButton=$cancel
  $form.Add_Shown({[void][QxnnAccountWindow]::ShowWindow($form.Handle,5);[void][QxnnAccountWindow]::SetForegroundWindow($form.Handle);$form.Activate();$fields[0].Focus()})
  if($form.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write((@{ok=$true;me=@{username=$fields[0].Text;password=$fields[1].Text};partner=@{username=$fields[2].Text;password=$fields[3].Text};token=$fields[4].Text}|ConvertTo-Json -Compress))
  } else {[Console]::Out.Write('{"ok":false}')}
  foreach($box in $fields.Values){$box.Clear()};$form.Dispose()
} catch {[Console]::Error.Write('Local account setup did not complete.');exit 1}
