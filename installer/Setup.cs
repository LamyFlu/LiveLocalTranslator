using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Linq;
using System.Reflection;
using System.Diagnostics;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;

class Setup {
  const string Product="LiveLocalTranslator",Version="0.4.2";
  const string NativeName="com.livelocaltranslator.files";
  static string DefaultRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),Product);
  static string UninstallKey="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\"+Product;
  static string NativeKey="Software\\Google\\Chrome\\NativeMessagingHosts\\"+NativeName;
  static JavaScriptSerializer Json(){return new JavaScriptSerializer{MaxJsonLength=8*1024*1024};}
  static string Arg(string[] a,string key,string fallback){int i=Array.IndexOf(a,key);return i>=0&&i+1<a.Length?a[i+1]:fallback;}
  static string ExistingRoot(){using(var k=Registry.CurrentUser.OpenSubKey(UninstallKey))return k==null?DefaultRoot:(string)k.GetValue("InstallLocation",DefaultRoot);}
  [STAThread] static void Main(string[] args){
    Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
    try{
      string root=Path.GetFullPath(Arg(args,"--root",ExistingRoot()));bool silent=args.Contains("--silent"),noRegister=args.Contains("--no-register");
      if(args.Contains("--uninstall")){
        string own=Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
        if(own.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)){
          string temp=Path.Combine(Path.GetTempPath(),"LiveLocalTranslator-Uninstall-"+Guid.NewGuid().ToString("N")+".exe");File.Copy(own,temp);Process.Start(new ProcessStartInfo(temp,"--uninstall --root \""+root+"\""+(silent?" --silent":"")+(args.Contains("--keep-models")?" --keep-models":"")+(noRegister?" --no-register":"")){UseShellExecute=false,CreateNoWindow=true});return;
        }
        bool keep=args.Contains("--keep-models");if(!silent){var answer=MessageBox.Show("移除程式與本機檔案橋接。\n\n要保留已下載模型與資料備份嗎？\n是：保留；否：一併刪除；取消：不移除。\n\nChrome 擴充功能請另外至 chrome://extensions 移除。","移除本機直播翻譯",MessageBoxButtons.YesNoCancel,MessageBoxIcon.Question,MessageBoxDefaultButton.Button1);if(answer==DialogResult.Cancel)return;keep=answer==DialogResult.Yes;}
        Uninstall(root,keep,noRegister);if(!silent)MessageBox.Show(keep?"程式已移除，模型與資料備份保留。":"程式與模型資料已移除。");return;
      }
      if(silent){Install(root,noRegister);return;}
      bool payload=Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains("payload.zip");
      var form=new Form{Text=payload?"本機直播翻譯 安裝／升級 "+Version:"本機直播翻譯 管理工具",Width=650,Height=370,StartPosition=FormStartPosition.CenterScreen};
      var text=new TextBox{Left=24,Top=55,Width=580,Text=root,ReadOnly=!payload};
      var label=new Label{Left=24,Top=20,Width=590,Text="使用者安裝位置（升級時維持相同路徑；不需系統管理員權限）"};
      var note=new Label{Left=24,Top=95,Width=585,Height=95,Text="首次安裝：請自行在 Chrome 開啟 chrome://extensions，啟用開發人員模式，載入下方位置的 extension 資料夾。\n\n升級：保留相同資料夾與模型，完成後在 Chrome 按重新載入。"};
      var install=new Button{Left=24,Top=205,Width=180,Text=payload?"安裝／升級":"開啟 Chrome 安裝頁"};var models=new Button{Left=220,Top=205,Width=170,Text="開啟模型資料夾"};var remove=new Button{Left=405,Top=205,Width=180,Text="移除程式"};
      install.Click+=async delegate{try{install.Enabled=false;if(payload)await System.Threading.Tasks.Task.Run(()=>Install(Path.GetFullPath(text.Text),false));string selected=Path.GetFullPath(text.Text);note.Text="已就緒："+Path.Combine(selected,"extension")+"\n\n請在 Chrome 手動載入該固定資料夾。模型存放在 models\\whisper 與 models\\llm；請參考 docs\\model-guide.html。";Process.Start("chrome.exe","chrome://extensions");Process.Start("explorer.exe",Path.Combine(selected,"extension"));}catch(Exception e){MessageBox.Show(e.Message,"安裝失敗");}finally{install.Enabled=true;}};
      models.Click+=delegate{string p=Path.Combine(text.Text,"models");Directory.CreateDirectory(p);Process.Start("explorer.exe",p);};
      remove.Click+=delegate{string exe=Path.Combine(text.Text,"Uninstall.exe");if(File.Exists(exe))Process.Start(exe,"--uninstall");else MessageBox.Show("此位置尚未安裝。");};
      form.Controls.AddRange(new Control[]{label,text,note,install,models,remove});Application.Run(form);
    }catch(Exception e){if(args.Contains("--silent")){File.WriteAllText(Path.Combine(Path.GetTempPath(),"LiveLocalTranslator-setup-error.txt"),e.ToString());Environment.ExitCode=1;}else MessageBox.Show(e.Message,"本機直播翻譯");}
  }
  static void ValidateRoot(string root,bool marker){
    if(root.Length<12||root==Path.GetPathRoot(root)||root.Equals(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),StringComparison.OrdinalIgnoreCase))throw new Exception("Unsafe installation path");
    if(Directory.Exists(root)&&(File.GetAttributes(root)&FileAttributes.ReparsePoint)!=0)throw new Exception("Installation directory cannot be a junction");
    if(marker){string file=Path.Combine(root,"install-marker.json");if(!File.Exists(file)||!File.ReadAllText(file).Contains("LiveLocalTranslator"))throw new Exception("Installation marker missing; refusing removal");}
  }
  static void StopHost(string root){foreach(var p in Process.GetProcessesByName("LiveLocalTranslator.Host"))try{if(Path.GetFullPath(p.MainModule.FileName).StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)){p.Kill();p.WaitForExit(5000);}}catch{}}
  static void Install(string root,bool noRegister){
    ValidateRoot(root,false);Directory.CreateDirectory(root);StopHost(root);
    using(var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")){
      if(resource==null)throw new Exception("This executable is a manager; download the Setup release to upgrade.");
      using(var zip=new ZipArchive(resource,ZipArchiveMode.Read))foreach(var entry in zip.Entries){
        string destination=Path.GetFullPath(Path.Combine(root,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
        if(!destination.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Invalid installer archive path");
        if(entry.FullName.StartsWith("models/",StringComparison.OrdinalIgnoreCase))throw new Exception("Installer must not overwrite user models");
        if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(destination);continue;}Directory.CreateDirectory(Path.GetDirectoryName(destination));using(var input=entry.Open())using(var output=File.Create(destination))input.CopyTo(output);
      }
    }
    Directory.CreateDirectory(Path.Combine(root,"models","whisper"));Directory.CreateDirectory(Path.Combine(root,"models","llm"));Directory.CreateDirectory(Path.Combine(root,"data"));
    var manifest=Json().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"extension","manifest.json")));string extensionId=File.ReadAllText(Path.Combine(root,"docs","extension-id.txt")).Trim();
    var origins=new HashSet<string>{"chrome-extension://"+extensionId+"/"};
    string profiles=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","User Data");
    if(Directory.Exists(profiles))foreach(string profile in Directory.GetDirectories(profiles))foreach(string name in new[]{"Preferences","Secure Preferences"})try{
      string pref=Path.Combine(profile,name);if(!File.Exists(pref))continue;var obj=Json().Deserialize<Dictionary<string,object>>(File.ReadAllText(pref));if(!obj.ContainsKey("extensions"))continue;var ex=(Dictionary<string,object>)obj["extensions"];if(!ex.ContainsKey("settings"))continue;var all=(Dictionary<string,object>)ex["settings"];
      foreach(var pair in all){var item=pair.Value as Dictionary<string,object>;if(item!=null&&item.ContainsKey("path")&&item["path"].ToString().IndexOf("TranslationGateway-browser-study",StringComparison.OrdinalIgnoreCase)>=0)origins.Add("chrome-extension://"+pair.Key+"/");}
    }catch{}
    var native=new{name=NativeName,description="Local model files for Live Local Translator",path=Path.Combine(root,"host","LiveLocalTranslator.Host.exe"),type="stdio",allowed_origins=origins.ToArray()};
    string nativeFile=Path.Combine(root,"host","native-host.json");File.WriteAllText(nativeFile,Json().Serialize(native),new UTF8Encoding(false));
    File.WriteAllText(Path.Combine(root,"install-marker.json"),Json().Serialize(new{product=Product,version=Version,root=root,installed=DateTime.UtcNow.ToString("o")}));
    if(!noRegister){
      using(var key=Registry.CurrentUser.CreateSubKey(NativeKey))key.SetValue("",nativeFile);
      using(var key=Registry.CurrentUser.CreateSubKey(UninstallKey)){key.SetValue("DisplayName","本機直播翻譯 · Live Local Translator");key.SetValue("DisplayVersion",Version);key.SetValue("InstallLocation",root);key.SetValue("UninstallString","\""+Path.Combine(root,"Uninstall.exe")+"\" --uninstall");key.SetValue("DisplayIcon",Path.Combine(root,"LiveLocalTranslator.exe"));key.SetValue("NoModify",1);key.SetValue("NoRepair",1);}
      string menu=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Live Local Translator");Directory.CreateDirectory(menu);Shortcut(Path.Combine(menu,"管理工具.lnk"),Path.Combine(root,"LiveLocalTranslator.exe"),"");Shortcut(Path.Combine(menu,"移除程式.lnk"),Path.Combine(root,"Uninstall.exe"),"--uninstall");
    }
  }
  static void Shortcut(string file,string target,string args){var shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));var link=shell.GetType().InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});link.GetType().InvokeMember("TargetPath",BindingFlags.SetProperty,null,link,new object[]{target});link.GetType().InvokeMember("Arguments",BindingFlags.SetProperty,null,link,new object[]{args});link.GetType().InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);}
  static void RemoveTree(string path,string root){string full=Path.GetFullPath(path);if(!full.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Removal escapes install directory");if(!Directory.Exists(full))return;if((File.GetAttributes(full)&FileAttributes.ReparsePoint)!=0){Directory.Delete(full);return;}foreach(string f in Directory.GetFiles(full))File.Delete(f);foreach(string d in Directory.GetDirectories(full))RemoveTree(d,root);Directory.Delete(full);}
  static void Uninstall(string root,bool keep,bool noRegister){
    ValidateRoot(root,true);StopHost(root);
    bool ownsInstall=false;using(var key=Registry.CurrentUser.OpenSubKey(UninstallKey))ownsInstall=key!=null&&String.Equals((string)key.GetValue("InstallLocation"),root,StringComparison.OrdinalIgnoreCase);
    if(!noRegister&&ownsInstall){string menu=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Live Local Translator");foreach(string name in new[]{"管理工具.lnk","移除程式.lnk"}){string shortcut=Path.Combine(menu,name);if(File.Exists(shortcut))File.Delete(shortcut);}if(Directory.Exists(menu)&&!Directory.EnumerateFileSystemEntries(menu).Any())Directory.Delete(menu);}
    if(!noRegister){using(var k=Registry.CurrentUser.OpenSubKey(NativeKey))if(k!=null&&String.Equals((string)k.GetValue(""),Path.Combine(root,"host","native-host.json"),StringComparison.OrdinalIgnoreCase))Registry.CurrentUser.DeleteSubKeyTree(NativeKey,false);using(var k=Registry.CurrentUser.OpenSubKey(UninstallKey))if(k!=null&&String.Equals((string)k.GetValue("InstallLocation"),root,StringComparison.OrdinalIgnoreCase))Registry.CurrentUser.DeleteSubKeyTree(UninstallKey,false);}
    foreach(string name in new[]{"extension","host","docs"})RemoveTree(Path.Combine(root,name),root);
    if(!keep){RemoveTree(Path.Combine(root,"models"),root);RemoveTree(Path.Combine(root,"data"),root);}
    foreach(string name in new[]{"LiveLocalTranslator.exe","Uninstall.exe","install-marker.json"}){string f=Path.Combine(root,name);if(File.Exists(f))File.Delete(f);}
    if(!Directory.EnumerateFileSystemEntries(root).Any())Directory.Delete(root);
  }
}
