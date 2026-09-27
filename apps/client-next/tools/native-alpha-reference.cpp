// Bounded D3D9 fixed-function reference for SRO 0xaae240 alpha state.
// This replays instruction-derived states; it is not the original application.
#include <windows.h>
#include <d3d9.h>
#include <cstdio>
#include <cstdlib>
static void check(HRESULT h) { if (FAILED(h)) { std::fprintf(stderr,"D3D9 HRESULT %08lx\n",h); std::exit(2); } }
struct Vertex { float x,y,z,w,u,v; };
int main(int argc,char** argv) {
 if(argc!=2&&argc!=3)return 1;
 const bool sweep=argc==3;
 const unsigned width=512,height=sweep?3072:12;
 HWND window=CreateWindowA("STATIC","SRO alpha reference",WS_POPUP,0,0,width,height,NULL,NULL,GetModuleHandle(NULL),NULL);
 IDirect3D9* api=Direct3DCreate9(D3D_SDK_VERSION);if(!api)return 2;
 D3DADAPTER_IDENTIFIER9 adapter={0};check(api->GetAdapterIdentifier(0,0,&adapter));
 D3DPRESENT_PARAMETERS pp={0};pp.Windowed=TRUE;pp.SwapEffect=D3DSWAPEFFECT_DISCARD;pp.hDeviceWindow=window;pp.BackBufferFormat=D3DFMT_UNKNOWN;
 IDirect3DDevice9* device=NULL;check(api->CreateDevice(0,D3DDEVTYPE_HAL,window,D3DCREATE_SOFTWARE_VERTEXPROCESSING|D3DCREATE_FPU_PRESERVE,&pp,&device));
 IDirect3DSurface9 *target=NULL,*readback=NULL;check(device->CreateRenderTarget(width,height,D3DFMT_A8R8G8B8,D3DMULTISAMPLE_NONE,0,FALSE,&target,NULL));
 check(device->CreateOffscreenPlainSurface(width,height,D3DFMT_A8R8G8B8,D3DPOOL_SYSTEMMEM,&readback,NULL));check(device->SetRenderTarget(0,target));
 D3DVIEWPORT9 viewport={0,0,width,height,0,1};check(device->SetViewport(&viewport));
 IDirect3DTexture9* texture=NULL;check(device->CreateTexture(2,1,1,0,D3DFMT_A8R8G8B8,D3DPOOL_MANAGED,&texture,NULL));
 D3DLOCKED_RECT locked={0};check(texture->LockRect(0,&locked,NULL,0));unsigned* pixels=static_cast<unsigned*>(locked.pBits);pixels[0]=0x00ff0000;pixels[1]=0xffff0000;check(texture->UnlockRect(0));check(device->SetTexture(0,texture));
 check(device->SetFVF(D3DFVF_XYZRHW|D3DFVF_TEX1));
 check(device->SetRenderState(D3DRS_LIGHTING,FALSE));check(device->SetRenderState(D3DRS_CULLMODE,D3DCULL_NONE));check(device->SetRenderState(D3DRS_ZENABLE,FALSE));
 check(device->SetRenderState(D3DRS_ALPHATESTENABLE,TRUE));check(device->SetRenderState(D3DRS_ALPHAFUNC,D3DCMP_GREATEREQUAL));
 check(device->SetRenderState(D3DRS_SRCBLEND,D3DBLEND_SRCALPHA));check(device->SetRenderState(D3DRS_DESTBLEND,D3DBLEND_INVSRCALPHA));
 check(device->SetSamplerState(0,D3DSAMP_MAGFILTER,D3DTEXF_LINEAR));check(device->SetSamplerState(0,D3DSAMP_MINFILTER,D3DTEXF_LINEAR));
 check(device->SetSamplerState(0,D3DSAMP_ADDRESSU,D3DTADDRESS_WRAP));check(device->SetSamplerState(0,D3DSAMP_ADDRESSV,D3DTADDRESS_WRAP));
 check(device->SetTextureStageState(0,D3DTSS_COLOROP,D3DTOP_SELECTARG1));check(device->SetTextureStageState(0,D3DTSS_COLORARG1,D3DTA_TEXTURE));
 check(device->SetTextureStageState(0,D3DTSS_ALPHAARG1,D3DTA_TEXTURE));check(device->SetTextureStageState(0,D3DTSS_ALPHAARG2,D3DTA_TFACTOR));
 check(device->Clear(0,NULL,D3DCLEAR_TARGET,0xff0000ff,1,0));check(device->BeginScene());
 const unsigned alpha[]={255,254,128,127,64,1};
 const unsigned references[]={1,64,128,192,254,255};
 for(unsigned row=0;row<height;row++) {
  const unsigned a=sweep?row%256:alpha[row%6];const bool fade=a!=255;
  const unsigned reference=sweep?references[row/512]:128;
  const bool factorOnly=sweep?((row/256)%2)!=0:row>=6;
  check(device->SetRenderState(D3DRS_ALPHABLENDENABLE,fade));check(device->SetRenderState(D3DRS_ALPHAREF,fade?(reference*a)>>8:reference));
  check(device->SetRenderState(D3DRS_TEXTUREFACTOR,a<<24));
  check(device->SetTextureStageState(0,D3DTSS_ALPHAOP,!fade?D3DTOP_SELECTARG1:factorOnly?D3DTOP_SELECTARG2:D3DTOP_MODULATE));
  const float y=static_cast<float>(row)-.5f;
  Vertex vertices[]={{-.5f,y,0,1,0,.5f},{width-.5f,y,0,1,1,.5f},{-.5f,y+1,0,1,0,.5f},{width-.5f,y+1,0,1,1,.5f}};
  check(device->DrawPrimitiveUP(D3DPT_TRIANGLESTRIP,2,vertices,sizeof(Vertex)));
 }
 check(device->EndScene());check(device->GetRenderTargetData(target,readback));check(readback->LockRect(&locked,NULL,D3DLOCK_READONLY));
 FILE* file=NULL;fopen_s(&file,argv[1],"wb");if(!file)return 3;
 for(unsigned y=0;y<height;y++)std::fwrite(static_cast<unsigned char*>(locked.pBits)+y*locked.Pitch,4,width,file);
 std::fclose(file);check(readback->UnlockRect());
 std::printf("D3D9 HAL: %s; vendor=%04lx device=%04lx; %ux%u BGRA\n",adapter.Description,adapter.VendorId,adapter.DeviceId,width,height);
 texture->Release();readback->Release();target->Release();device->Release();api->Release();DestroyWindow(window);return 0;
}
