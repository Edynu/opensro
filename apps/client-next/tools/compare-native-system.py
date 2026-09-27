"""Compare the System chrome; only source-transparent corner pixels are excluded."""
from pathlib import Path
from PIL import Image
from io import BytesIO
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[1]
game = root.parents[2]
retail = Image.open(root / 'tests/fixtures/native/native-system-retail.png').convert('RGB').crop((19,3,233,215))
port = Image.open(sys.argv[1]).convert('RGB').crop((693,344,907,556))
mask = Image.new('L',(214,212),255)
for name, x in (('left_up',0),('right_up',174)):
    data = (game / ('extracted/Media_extracted/interface/frame/mframe_wnd_'+name+'.ddj')).read_bytes()
    image = Image.open(BytesIO(data[20:])).convert('RGBA')
    mask.paste(image.getchannel('A'),(x,0))
compared=0;different=0;maximum=0;excluded=0
for y in range(212):
    for x in range(214):
        if mask.getpixel((x,y)) == 0:
            excluded+=1;continue
        compared+=1
        p=retail.getpixel((x,y));q=port.getpixel((x,y));error=max(abs(p[i]-q[i]) for i in range(3))
        different+=error!=0;maximum=max(maximum,error)
result=dict(compared=compared,excludedSourceTransparent=excluded,differingPixels=different,maxChannelError=maximum,referenceSha256=hashlib.sha256((root/'tests/fixtures/native/native-system-retail.png').read_bytes()).hexdigest())
print(json.dumps(result))
if excluded!=69 or different:raise SystemExit(1)
