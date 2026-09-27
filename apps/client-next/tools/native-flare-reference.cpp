// Bounded D3D9 replay of 8AD4A0's XYZRHW chain, not an original-client capture.
#include <windows.h>
#include <d3d9.h>
#include <d3dx9tex.h>
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <cstring>
static void check(HRESULT h){if(FAILED(h)){std::fprintf(stderr,"D3D9 %08lx\n",h);std::exit(2);}}
struct Vertex {float x,y,z,w,u,v;};
int main(int argc,char** argv){
 if(argc!=2&&argc!=3)return 1;
 const unsigned width=512,height=384;
 HWND window=CreateWindowA("STATIC","Flare reference",WS_POPUP,0,0,width,height,0,0,GetModuleHandle(0),0);
 IDirect3D9* api=Direct3DCreate9(D3D_SDK_VERSION);if(!api)return 2;
 D3DADAPTER_IDENTIFIER9 adapter={0};check(api->GetAdapterIdentifier(0,0,&adapter));
 D3DPRESENT_PARAMETERS pp={0};pp.Windowed=TRUE;pp.SwapEffect=D3DSWAPEFFECT_DISCARD;pp.hDeviceWindow=window;
 IDirect3DDevice9* d=0;check(api->CreateDevice(0,D3DDEVTYPE_HAL,window,D3DCREATE_SOFTWARE_VERTEXPROCESSING|D3DCREATE_FPU_PRESERVE,&pp,&d));
 IDirect3DSurface9 *target=0,*readback=0;check(d->CreateRenderTarget(width,height,D3DFMT_A8R8G8B8,D3DMULTISAMPLE_NONE,0,FALSE,&target,0));
 check(d->CreateOffscreenPlainSurface(width,height,D3DFMT_A8R8G8B8,D3DPOOL_SYSTEMMEM,&readback,0));check(d->SetRenderTarget(0,target));
 D3DVIEWPORT9 viewport={0,0,width,height,0,1};check(d->SetViewport(&viewport));
 IDirect3DTexture9* textures[8]={0};D3DLOCKED_RECT locked={0};
 for(unsigned t=0;t<8;t++){
  if(argc==3){
   char path[2048];sprintf_s(path,sizeof(path),"%s/lens%u.ddj",argv[2],t+1);
   FILE* input=0;fopen_s(&input,path,"rb");if(!input)return 4;
   std::fseek(input,0,SEEK_END);long size=std::ftell(input);std::rewind(input);
   if(size<148||size>16*1024*1024)return 4;
   std::vector<unsigned char> bytes(size);if(std::fread(&bytes[0],1,size,input)!=static_cast<unsigned>(size))return 4;std::fclose(input);
   if(std::memcmp(&bytes[0],"JMXVDDJ 1000",12)||std::memcmp(&bytes[20],"DDS ",4))return 4;
   // 899550 -> 9F92D0 -> 9F8EA0(arg4=1) -> 9257DF: D3DX default
   // dimensions/format/mips, managed pool, default image and mip filters.
   check(D3DXCreateTextureFromFileInMemory(d,&bytes[20],size-20,&textures[t]));
   D3DSURFACE_DESC desc;check(textures[t]->GetLevelDesc(0,&desc));
   std::printf("lens%u: %ux%u format=%08x levels=%u\n",t+1,desc.Width,desc.Height,desc.Format,textures[t]->GetLevelCount());
  }else{
   check(d->CreateTexture(1,1,1,0,D3DFMT_A8R8G8B8,D3DPOOL_MANAGED,&textures[t],0));check(textures[t]->LockRect(0,&locked,0,0));*static_cast<unsigned*>(locked.pBits)=((32+t*29)<<24)|((23+t*27)<<16)|((211-t*19)<<8)|(37+t*13);check(textures[t]->UnlockRect(0));
  }
 }
 check(d->SetFVF(D3DFVF_XYZRHW|D3DFVF_TEX1));check(d->SetRenderState(D3DRS_ZENABLE,FALSE));check(d->SetRenderState(D3DRS_CULLMODE,D3DCULL_NONE));check(d->SetRenderState(D3DRS_LIGHTING,FALSE));check(d->SetRenderState(D3DRS_ALPHATESTENABLE,FALSE));check(d->SetRenderState(D3DRS_ALPHABLENDENABLE,TRUE));check(d->SetRenderState(D3DRS_SRCBLEND,D3DBLEND_SRCALPHA));
 check(d->SetTextureStageState(0,D3DTSS_COLOROP,D3DTOP_MODULATE));check(d->SetTextureStageState(0,D3DTSS_COLORARG1,D3DTA_TEXTURE));check(d->SetTextureStageState(0,D3DTSS_COLORARG2,D3DTA_TFACTOR));check(d->SetTextureStageState(0,D3DTSS_ALPHAOP,D3DTOP_MODULATE));check(d->SetTextureStageState(0,D3DTSS_ALPHAARG1,D3DTA_TEXTURE));check(d->SetTextureStageState(0,D3DTSS_ALPHAARG2,D3DTA_TFACTOR));check(d->SetTextureStageState(1,D3DTSS_COLOROP,D3DTOP_DISABLE));
 check(d->SetSamplerState(0,D3DSAMP_MINFILTER,D3DTEXF_LINEAR));check(d->SetSamplerState(0,D3DSAMP_MAGFILTER,D3DTEXF_LINEAR));
 check(d->SetSamplerState(0,D3DSAMP_MIPFILTER,D3DTEXF_LINEAR));check(d->SetSamplerState(0,D3DSAMP_ADDRESSU,D3DTADDRESS_WRAP));check(d->SetSamplerState(0,D3DSAMP_ADDRESSV,D3DTADDRESS_WRAP));
 const unsigned indices[]={6,5,2,6,5,6,3,6,5,6,4,5,6,4,5,6,4,5,6,4,4,5,7,4,5,6,6,5,6,4};
 const float sizes[]={30,40,150,30,40,50,300,40,30,50,0,30,40,0,40,30,0,80,40,0,0,30,120,0,40,30,30,80,40,0};
 const float offsets[][2]={{-1,-1},{1,-1},{1,1},{-1,1}};
 FILE* file=0;fopen_s(&file,argv[1],"wb");if(!file)return 3;
 for(unsigned scenario=0;scenario<4;scenario++){
  const float x=173.25f+scenario*.25f,y=137.5f-scenario*.25f;
  // 8AD4A0 stores each successful weighted query back to a float.
  // A decimal .65f is not the result of that ordered accumulation.
  volatile float visibility=0;
  for(unsigned sample=0;sample<5;sample++){const bool hit=scenario==0||scenario==1&&sample==0||scenario==2&&sample==1||scenario==3&&sample<3;if(hit)visibility=visibility+(sample==0?.30000001192092896f:.17499999701976776f);}
  const float chainX=((width*.5f-x)*2.2f)*.5f,chainY=((height*.5f-y)*2.2f)*.5f;
  check(d->Clear(0,0,D3DCLEAR_TARGET,0xff172b43,1,0));check(d->BeginScene());
  for(unsigned i=0;i<30;i++){if(!sizes[i])continue;
   const float factor=(static_cast<int>(i)-2)/19.f;
   // 8ADAAC..8ADABE stores each product to binary32 BEFORE the centre
   // addition at 8ADACC..8ADAE0. An ordinary C++ expression keeps the
   // product in x87 extended precision (old fixture 402652..402669).
   volatile float offsetX=factor*chainX,offsetY=factor*chainY;
   const float cx=x+offsetX,cy=y+offsetY;
   const unsigned a=static_cast<unsigned>((i<2?10:i==2?255:i>=10?30-i:20)*visibility);
   check(d->SetRenderState(D3DRS_TEXTUREFACTOR,(a<<24)|0xffffff));check(d->SetRenderState(D3DRS_DESTBLEND,i==2||indices[i]==3||indices[i]==7?D3DBLEND_INVSRCALPHA:D3DBLEND_ONE));check(d->SetTexture(0,textures[indices[i]]));
   Vertex vertices[6];unsigned n=0;if(i==2){Vertex centre={cx,cy,.1f,.1f,.5f,.5f};vertices[n++]=centre;}
   for(unsigned corner=0;corner<4;corner++){Vertex v={cx+offsets[corner][0]*sizes[i]*(i==2?2:1),cy+offsets[corner][1]*sizes[i]*(i==2?2:1),.1f,.1f,(offsets[corner][0]+1)*.5f,(offsets[corner][1]+1)*.5f};vertices[n++]=v;}
   if(i==2)vertices[n++]=vertices[1];check(d->DrawPrimitiveUP(D3DPT_TRIANGLEFAN,i==2?4:2,vertices,sizeof(Vertex)));
  }
  check(d->EndScene());check(d->GetRenderTargetData(target,readback));check(readback->LockRect(&locked,0,D3DLOCK_READONLY));for(unsigned row=0;row<height;row++)std::fwrite(static_cast<unsigned char*>(locked.pBits)+row*locked.Pitch,4,width,file);check(readback->UnlockRect());
 }
 std::fclose(file);std::printf("D3D9 HAL: %s; 512x384 x4 BGRA\n",adapter.Description);
 for(unsigned i=0;i<8;i++)textures[i]->Release();readback->Release();target->Release();d->Release();api->Release();DestroyWindow(window);return 0;
}
