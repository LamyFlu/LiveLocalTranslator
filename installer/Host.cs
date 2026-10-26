using System;
using System.IO;
using System.Text;
using System.Net;
using System.Net.Sockets;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

// Local files and pinned model downloads. No inference, public binding or telemetry.
class Host {
  static string Root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
  static string Models=Path.Combine(Root,"models");
  static string Token=Guid.NewGuid().ToString("N")+Guid.NewGuid().ToString("N");
  static TcpListener Listener;
  static ConcurrentDictionary<string,Upload> Uploads=new ConcurrentDictionary<string,Upload>();
  static HashSet<string> Origins=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
  static object StdoutLock=new object();
  class Upload { public string Part,Target; public long Total,Offset; public FileStream Stream; public object Gate=new object(); }
  static JavaScriptSerializer Json(){return new JavaScriptSerializer{MaxJsonLength=4*1024*1024};}
  static byte[] ReadExactly(Stream s,int count){var b=new byte[count];int n=0;while(n<count){int k=s.Read(b,n,count-n);if(k==0)throw new EndOfStreamException();n+=k;}return b;}
  static void Send(object message){byte[] b=Encoding.UTF8.GetBytes(Json().Serialize(message));lock(StdoutLock){var o=Console.OpenStandardOutput();o.Write(BitConverter.GetBytes(b.Length),0,4);o.Write(b,0,b.Length);o.Flush();}}
  static object Catalog(){
    var whisper=new List<object>();var llm=new List<object>();Directory.CreateDirectory(Models);
    string wr=Path.Combine(Models,"whisper"),lr=Path.Combine(Models,"llm");Directory.CreateDirectory(wr);Directory.CreateDirectory(lr);
    foreach(var d in Directory.GetDirectories(wr)){if(IsReparse(d))continue;string onnx=Path.Combine(d,"onnx");string dtype=File.Exists(Path.Combine(onnx,"encoder_model.onnx"))?"fp32":File.Exists(Path.Combine(onnx,"encoder_model_fp16.onnx"))?"fp16":null;bool ok=File.Exists(Path.Combine(d,"config.json"))&&File.Exists(Path.Combine(d,"tokenizer.json"))&&dtype!=null&&File.Exists(Path.Combine(onnx,"decoder_model_merged_q4.onnx"));whisper.Add(new{id=Path.GetFileName(d),ready=ok,encoderDtype=dtype,files=Directory.GetFiles(d,"*",SearchOption.AllDirectories).Length});}
    foreach(var d in Directory.GetDirectories(lr)){if(IsReparse(d)||ModelDownloads.Contains(Path.GetFileName(d)))continue;foreach(var f in Directory.GetFiles(d,"*-web.litertlm")){llm.Add(new{id=Path.GetFileName(d),file=Path.GetFileName(f),ready=true,bytes=new FileInfo(f).Length});}}
    llm.AddRange(ModelDownloads.ModelsList());
    return new{root=Models,whisper=whisper,llm=llm,inventory=ModelFiles.Inventory()};
  }
  static bool IsReparse(string p){return (File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0;}
  static string SafeModelPath(string relative){
    relative=relative.Replace('/',Path.DirectorySeparatorChar);
    if(Path.IsPathRooted(relative)||relative.IndexOf(':')>=0)throw new Exception("Absolute paths are not accepted");
    string full=Path.GetFullPath(Path.Combine(Models,relative));string prefix=Path.GetFullPath(Models)+Path.DirectorySeparatorChar;
    if(!full.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new Exception("Path escapes model directory");
    string first=relative.Split(Path.DirectorySeparatorChar)[0];if(first!="whisper"&&first!="llm")throw new Exception("Unknown model type");
    var p=new DirectoryInfo(Path.GetDirectoryName(full));while(p!=null&&p.FullName.StartsWith(Path.GetFullPath(Models),StringComparison.OrdinalIgnoreCase)){if(p.Exists&&IsReparse(p.FullName))throw new Exception("Model directory cannot be a junction");p=p.Parent;}
    if(File.Exists(full)&&IsReparse(full))throw new Exception("Model file cannot be a symbolic link");return full;
  }
  static void Main(string[] args){
    try{
      var native=Json().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"native-host.json")));
      foreach(var origin in (System.Collections.IEnumerable)native["allowed_origins"])Origins.Add(origin.ToString().TrimEnd('/'));
      Listener=new TcpListener(IPAddress.Loopback,0);Listener.Start();Task.Run((Action)Accept);
      var input=Console.OpenStandardInput();while(true){int len=BitConverter.ToInt32(ReadExactly(input,4),0);if(len<1||len>1024*1024)throw new Exception("Invalid native message length");var m=Json().Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(ReadExactly(input,len)));object id=m.ContainsKey("id")?m["id"]:null;
        try{string op=m["op"].ToString();object result;
          if(op=="hello"||op=="list")result=new{version="0.4.2",baseUrl="http://127.0.0.1:"+((IPEndPoint)Listener.LocalEndpoint).Port+"/token/"+Token,models=Catalog()};
          else if(op=="pinModels")result=ModelFiles.Pin(m["whisperId"].ToString(),m["llmId"].ToString());
          else if(op=="unpinModels")result=ModelFiles.Release();
          else if(op=="deleteModel")result=ModelFiles.Delete(m["kind"].ToString(),m["modelId"].ToString());
          else if(op=="downloadStart")result=ModelDownloads.Start(m["modelId"].ToString());
          else if(op=="downloadStatus")result=ModelDownloads.Status();
          else if(op=="downloadCancel")result=ModelDownloads.Cancel();
          else if(op=="openModels"){System.Diagnostics.Process.Start("explorer.exe",Models);result=new{ok=true};}
          else if(op=="saveBackup"){Directory.CreateDirectory(Path.Combine(Root,"data"));File.WriteAllText(Path.Combine(Root,"data","legacy-backup.json"),Json().Serialize(m["data"]),new UTF8Encoding(false));result=new{ok=true};}
          else if(op=="readBackup"){string p=Path.Combine(Root,"data","legacy-backup.json");result=File.Exists(p)?Json().DeserializeObject(File.ReadAllText(p)):null;}
          else throw new Exception("Unsupported native operation");Send(new{id=id,result=result});
        }catch(Exception e){Send(new{id=id,error=e.Message});}
      }
    }catch(EndOfStreamException){}catch(Exception e){Console.Error.WriteLine(e.Message);}finally{if(Listener!=null)Listener.Stop();foreach(var u in Uploads.Values)try{u.Stream.Dispose();}catch{}}
  }
  static void Accept(){while(true){try{var c=Listener.AcceptTcpClient();Task.Run(()=>Handle(c));}catch{return;}}}
  static string ReadLine(Stream stream){var b=new MemoryStream();while(b.Length<16384){int v=stream.ReadByte();if(v<0)throw new EndOfStreamException();if(v==10)return Encoding.ASCII.GetString(b.ToArray()).TrimEnd('\r');b.WriteByte((byte)v);}throw new Exception("Header too long");}
  static void Reply(Stream s,int status,byte[] body,string contentType,string origin,Dictionary<string,string> more){
    var h=new StringBuilder("HTTP/1.1 "+status+" "+(status==200?"OK":status==206?"Partial Content":status==204?"No Content":"Error")+"\r\nConnection: close\r\nContent-Type: "+contentType+"\r\nContent-Length: "+body.Length+"\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n");
    if(origin!=null)h.Append("Access-Control-Allow-Origin: "+origin+"\r\nVary: Origin\r\n");h.Append("Access-Control-Allow-Methods: GET, HEAD, POST, PUT, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Offset, Range\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range\r\n");if(more!=null)foreach(var pair in more)h.Append(pair.Key+": "+pair.Value+"\r\n");h.Append("\r\n");byte[] head=Encoding.ASCII.GetBytes(h.ToString());s.Write(head,0,head.Length);s.Write(body,0,body.Length);
  }
  static void JsonReply(Stream s,object o,string origin){Reply(s,200,Encoding.UTF8.GetBytes(Json().Serialize(o)),"application/json; charset=utf-8",origin,null);}
  static void Handle(TcpClient client){
    using(client){client.ReceiveTimeout=30000;client.SendTimeout=30000;var s=client.GetStream();string origin=null;
      try{
        string[] first=ReadLine(s).Split(' ');if(first.Length<2)throw new Exception("Invalid request");string method=first[0];var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);for(int i=0;i<64;i++){string line=ReadLine(s);if(line.Length==0)break;int colon=line.IndexOf(':');if(colon>0)headers[line.Substring(0,colon)]=line.Substring(colon+1).Trim();}
        if(headers.ContainsKey("Origin")){origin=headers["Origin"];if(!Origins.Contains(origin)){Reply(s,403,new byte[0],"text/plain",null,null);return;}}
        if(headers.ContainsKey("Host")&&!headers["Host"].StartsWith("127.0.0.1:",StringComparison.Ordinal)){Reply(s,403,new byte[0],"text/plain",null,null);return;}
        string url=Uri.UnescapeDataString(first[1].Split('?')[0]);string prefix="/token/"+Token+"/";if(!url.StartsWith(prefix,StringComparison.Ordinal)){Reply(s,403,new byte[0],"text/plain",origin,null);return;}string route=url.Substring(prefix.Length);
        if(method=="OPTIONS"){Reply(s,204,new byte[0],"text/plain",origin,null);return;}
        long contentLength=headers.ContainsKey("Content-Length")?long.Parse(headers["Content-Length"]):0;if(contentLength<0||contentLength>4*1024*1024)throw new Exception("Request body exceeds 4MB");
        if((method=="GET"||method=="HEAD")&&route.StartsWith("models/",StringComparison.Ordinal)){
          string file=SafeModelPath(route.Substring(7));if(!File.Exists(file)){Reply(s,404,new byte[0],"text/plain",origin,null);return;}
          using(var f=File.OpenRead(file)){
            long start=0,end=f.Length-1;int code=200;
            if(headers.ContainsKey("Range")){var r=headers["Range"];if(!r.StartsWith("bytes="))throw new Exception("Unsupported range");var values=r.Substring(6).Split('-');start=long.Parse(values[0]);if(values.Length>1&&values[1].Length>0)end=long.Parse(values[1]);end=Math.Min(end,f.Length-1);if(start<0||start>end){Reply(s,416,new byte[0],"text/plain",origin,null);return;}code=206;}
            long length=end-start+1;string type=file.EndsWith(".json",StringComparison.OrdinalIgnoreCase)?"application/json":"application/octet-stream";
            string h="HTTP/1.1 "+code+" OK\r\nConnection: close\r\nContent-Type: "+type+"\r\nContent-Length: "+length+"\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"+(origin==null?"":"Access-Control-Allow-Origin: "+origin+"\r\n")+(code==206?"Content-Range: bytes "+start+"-"+end+"/"+f.Length+"\r\n":"")+"\r\n";byte[] hb=Encoding.ASCII.GetBytes(h);s.Write(hb,0,hb.Length);if(method=="HEAD")return;f.Position=start;byte[] buffer=new byte[256*1024];while(length>0){int n=f.Read(buffer,0,(int)Math.Min(length,buffer.Length));if(n==0)break;s.Write(buffer,0,n);length-=n;}return;
          }
        }
        if(method=="GET"&&route=="catalog"){JsonReply(s,Catalog(),origin);return;}
        if(method=="POST"&&route=="import"){
          var m=Json().Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(ReadExactly(s,(int)contentLength)));string relative=m["path"].ToString();string target=SafeModelPath(relative);string ext=Path.GetExtension(target).ToLowerInvariant();if(Array.IndexOf(new[]{".json",".txt",".model",".onnx",".bin",".litertlm",".onnx_data"},ext)<0)throw new Exception("Unsupported model file type");long total=Convert.ToInt64(m["bytes"]);if(total < -1||total>32L*1024*1024*1024)throw new Exception("Invalid file size");
          ModelFiles.EnsureSpace(Math.Max(0,total));
          if(File.Exists(target)){if(new FileInfo(target).Length==total){JsonReply(s,new{exists=true,bytes=total},origin);return;}throw new Exception("Existing model has different size; preserve it and choose another model folder");}
          Directory.CreateDirectory(Path.GetDirectoryName(target));string uid=Guid.NewGuid().ToString("N");var u=new Upload{Target=target,Part=target+"."+uid+".importing",Total=total,Offset=0};u.Stream=new FileStream(u.Part,FileMode.CreateNew,FileAccess.Write,FileShare.None);Uploads[uid]=u;JsonReply(s,new{id=uid},origin);return;
        }
        if(route.StartsWith("import/",StringComparison.Ordinal)){
          string[] parts=route.Split('/');Upload u;if(parts.Length<2||!Uploads.TryGetValue(parts[1],out u))throw new Exception("Unknown upload");lock(u.Gate){
            if(method=="PUT"&&parts.Length==2){long offset=headers.ContainsKey("X-Offset")?long.Parse(headers["X-Offset"]):-1;if(offset!=u.Offset||(u.Total>=0&&u.Offset+contentLength>u.Total)||u.Offset+contentLength>32L*1024*1024*1024)throw new Exception("Upload offset mismatch");var body=ReadExactly(s,(int)contentLength);u.Stream.Write(body,0,body.Length);u.Offset+=body.Length;JsonReply(s,new{bytes=u.Offset},origin);return;}
            if(method=="POST"&&parts.Length==3&&parts[2]=="complete"){var complete=Json().Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(ReadExactly(s,(int)contentLength)));long expected=Convert.ToInt64(complete["bytes"]);if(u.Offset!=expected||(u.Total>=0&&u.Offset!=u.Total))throw new Exception("Incomplete model file");u.Stream.Flush(true);u.Stream.Dispose();string hash;using(var sha=SHA256.Create())using(var f=File.OpenRead(u.Part))hash=BitConverter.ToString(sha.ComputeHash(f)).Replace("-","").ToLowerInvariant();File.Move(u.Part,u.Target);Upload ignored;Uploads.TryRemove(parts[1],out ignored);File.WriteAllText(u.Target+".sha256",hash+"  "+Path.GetFileName(u.Target));JsonReply(s,new{bytes=u.Offset,sha256=hash},origin);return;}
          }
        }
        Reply(s,404,new byte[0],"text/plain",origin,null);
      }catch(Exception e){try{Reply(s,400,Encoding.UTF8.GetBytes(Json().Serialize(new{error=e.Message})),"application/json",origin,null);}catch{}}
    }
  }
}
