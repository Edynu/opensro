// Publish texture resource bytes, including generated D3DX mip levels.
// No rendering/readback or captured pixels are involved.
#include <windows.h>
#include <d3d9.h>
#include <d3dx9.h>
#include <cstdio>
#include <vector>
#include <cstring>
static void check(HRESULT h){if(FAILED(h)){std::fprintf(stderr,"HRESULT %08x\n",h);ExitProcess(2);}}
int main(int argc,char**argv){
 if(argc!=3)return 1;
 HWND w=CreateWindowA("STATIC","Texture compiler",WS_POPUP,0,0,64,64,0,0,GetModuleHandle(0),0);
 IDirect3D9* api=Direct3DCreate9(D3D_SDK_VERSION);if(!api)return 2;
 D3DPRESENT_PARAMETERS pp={0};pp.Windowed=TRUE;pp.SwapEffect=D3DSWAPEFFECT_DISCARD;pp.hDeviceWindow=w;
 IDirect3DDevice9*d=0;check(api->CreateDevice(0,D3DDEVTYPE_HAL,w,D3DCREATE_SOFTWARE_VERTEXPROCESSING|D3DCREATE_FPU_PRESERVE,&pp,&d));
 for(unsigned i=1;i<=8;i++){
  char path[2048];sprintf_s(path,sizeof(path),"%s/lens%u.ddj",argv[1],i);FILE*f=0;fopen_s(&f,path,"rb");if(!f)return 3;
  std::fseek(f,0,SEEK_END);long n=std::ftell(f);std::rewind(f);if(n<148||n>16*1024*1024)return 3;
  std::vector<unsigned char>b(n);if(std::fread(&b[0],1,n,f)!=static_cast<unsigned>(n))return 3;std::fclose(f);
  if(std::memcmp(&b[0],"JMXVDDJ 1000",12)||std::memcmp(&b[20],"DDS ",4))return 3;
  IDirect3DTexture9*t=0;check(D3DXCreateTextureFromFileInMemory(d,&b[20],n-20,&t));
  D3DSURFACE_DESC desc;check(t->GetLevelDesc(0,&desc));if(desc.Format!=D3DFMT_A8R8G8B8&&desc.Format!=D3DFMT_DXT3)return 4;
  sprintf_s(path,sizeof(path),"%s/lens%u.texture",argv[2],i);fopen_s(&f,path,"wb");if(!f)return 5;
  unsigned header[]={0x3158544e,desc.Width,desc.Height,static_cast<unsigned>(desc.Format),t->GetLevelCount()};std::fwrite(header,4,5,f);
  for(unsigned level=0;level<t->GetLevelCount();level++){
   check(t->GetLevelDesc(level,&desc));D3DLOCKED_RECT lock;check(t->LockRect(level,&lock,0,D3DLOCK_READONLY));
   const bool bc=desc.Format==D3DFMT_DXT3;const unsigned rows=bc?(desc.Height+3)/4:desc.Height,stride=bc?((desc.Width+3)/4)*16:desc.Width*4;
   for(unsigned y=0;y<rows;y++)if(std::fwrite(static_cast<unsigned char*>(lock.pBits)+y*lock.Pitch,1,stride,f)!=stride)return 6;
   check(t->UnlockRect(level));
  }
  std::fclose(f);t->Release();
 }
 d->Release();api->Release();DestroyWindow(w);return 0;
}
