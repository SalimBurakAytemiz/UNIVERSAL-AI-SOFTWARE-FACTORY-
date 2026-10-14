' //TR: Bu sarmalayici UASCO-Supervisor-Watchdog gorevinin pencere acmayan kok surecidir: Task Scheduler bunu wscript.exe //B //Nologo ile her 5 dakikada baslatir (masaustunde konsol penceresi acilmaz, odak calinmaz), yanindaki watchdog betigini mutlak node.exe ile dogrulanmis bagimsiz degiskenlerle gizli pencerede calistirir, bitmesini bekler ve cikis kodunu Task Scheduler'a aynen iletir. Baska hicbir sey yapmaz.
Option Explicit
Dim fso, sh, args, repo, node, here, root, watchdog, p, rc
Set args = WScript.Arguments
If args.Count <> 2 Then WScript.Quit 64
repo = args(0)
node = args(1)
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(here)
watchdog = fso.BuildPath(here, "uasco-supervisor-watchdog.mjs")
For Each p In Array(repo, node, watchdog, root)
  If Not SafePath(p) Then WScript.Quit 64
Next
If LCase(Right(node, 9)) <> "\node.exe" Then WScript.Quit 64
If Not fso.FileExists(node) Then WScript.Quit 64
If Not fso.FolderExists(repo) Then WScript.Quit 64
If Not fso.FileExists(watchdog) Then WScript.Quit 6
Set sh = CreateObject("WScript.Shell")
rc = sh.Run(Q(node) & " " & Q(watchdog) & " --repo " & Q(repo) & " --control-root " & Q(root), 0, True)
WScript.Quit rc

Function Q(s)
  Q = Chr(34) & s & Chr(34)
End Function

' //TR: Gorev ve komut satirina giren her yol bootstrap ile ayni kurala uyar: mutlak yerel yol, surucu koku degil; tirnak, yuzde, ters tirnak, koseli parantez, joker ve kontrol karakteri yok; sonda ters egik cizgi, nokta veya bosluk yok.
Function SafePath(s)
  Dim bad, shape, tail
  Set bad = New RegExp
  bad.Pattern = "[""%`\r\n\t*?<>|\[\]]"
  Set shape = New RegExp
  shape.Pattern = "^[A-Za-z]:\\[^\\]"
  Set tail = New RegExp
  tail.Pattern = "[\\. ]$"
  SafePath = (Len(s) > 3) And (Not bad.Test(s)) And shape.Test(s) And (Not tail.Test(s))
End Function
