import sys, struct, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from convert_images import decode_native_rgb16

class NativeUiTextureTests(unittest.TestCase):
 def payload(self):
  data=bytearray(128+132);data[:4]=b'DDS '
  struct.pack_into('<5I',data,4,124,8,1,32,132)
  struct.pack_into('<8I',data,76,32,65,0,16,0x7c00,0x3e0,0x1f,0x8000)
  for i in range(32):struct.pack_into('<H',data,128+2*i,(0x8000 if i%2 else 0)|(i<<10)|(i<<5)|i)
  return data
 def test_all_channel_levels_and_alpha(self):
  image=decode_native_rgb16(self.payload())
  expected=[0,8,16,24,33,41,49,57,66,74,82,90,99,107,115,123,132,140,148,156,165,173,181,189,198,206,214,222,231,239,247,255]
  for i,v in enumerate(expected):self.assertEqual(image.getpixel((i,0)),(v,v,v,255 if i%2 else 0))
 def test_565_all_green_levels(self):
  data=self.payload();struct.pack_into('<5I',data,4,124,8,1,64,132)
  struct.pack_into('<8I',data,76,32,64,0,16,0xf800,0x7e0,0x1f,0)
  for i in range(64):struct.pack_into('<H',data,128+2*i,0xf81f|(i<<5))
  image=decode_native_rgb16(data)
  for i in range(64):self.assertEqual(image.getpixel((i,0)),(255,(i<<2)|(i>>4),255,255))
 def test_format_and_truncation(self):
  data=self.payload();data[84:88]=b'DXT1';self.assertIsNone(decode_native_rgb16(data))
  with self.assertRaises(ValueError):decode_native_rgb16(self.payload()[:-1])
if __name__=='__main__':unittest.main()
