Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\Acer\Downloads\avances"
shell.Run """C:\Users\Acer\Downloads\avances\env\Scripts\python.exe"" ""C:\Users\Acer\Downloads\avances\app.py""", 0, False
MsgBox "Servidor iniciado en http://localhost:5000", 64, "Plantas Chocoanas"
