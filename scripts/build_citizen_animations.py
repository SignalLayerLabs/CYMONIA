#!/usr/bin/env python3
"""Build deterministic four-frame articulated sprites from the bundled poses.

Requires Pillow. No downloads, world state, AI service or remote artwork. The
source illustrations remain authoritative; these small cutout animations are
replaceable observer assets, not physical tools/materials added to the world.
"""
from pathlib import Path
import json, math, subprocess
from PIL import Image, ImageDraw, ImageChops
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'site/assets'
node = ['node', '--input-type=module', '-e']
layout = json.loads(subprocess.check_output(node + ["import {CITIZEN_SPRITE_ATLASES as a} from './site/citizen-sprite-frames.js';console.log(JSON.stringify(a));"], cwd=ROOT))
states = json.loads(subprocess.check_output(node + ["import {ANIMATED_SPRITE_STATES as a} from './site/action-animations.js';console.log(JSON.stringify(a));"], cwd=ROOT))
CELL_W, CELL_H, COLS = 96, 112, 16
# base pose, arm angle, knee/leg stride, torso lean, vertical reach
PROFILES = {
 'idle':(0,2,0,0,0),'walk':(1,10,12,2,1),'observe':(2,6,0,1,0),
 'rest':(11,3,0,0,0),'sleep':(-1,0,0,0,0),'eat':(3,8,0,1,0),'drink':(4,10,0,2,0),
 'gather':(5,12,0,3,2),'carry':(0,6,5,1,0),'cut':(7,22,2,4,1),
 'dig':(8,13,2,4,2),'heat':(2,7,0,2,0),'cool':(0,18,0,1,0),
 'mix':(9,12,0,1,0),'assemble':(10,9,0,2,1),'build':(10,16,0,4,1),
 'care':(11,8,0,1,0),'teach':(12,18,0,1,0),'communicate':(12,10,0,1,0),
 'experiment':(13,11,0,2,0),'attack':(14,25,5,5,1),'defend':(15,9,2,2,0),
 'transfer':(12,13,0,2,1),'promise':(12,5,0,1,0),'claim':(12,20,0,3,0),
 'reproduce':(12,6,0,2,0),'destroy':(14,32,4,7,2),'dismantle':(10,11,0,3,1),
 'repair':(10,8,0,2,0),'pickup':(5,17,1,5,3),'drop':(5,-17,1,3,3),
 'force':(0,28,0,5,1),'support':(0,8,0,1,0),'contain':(9,5,0,1,0),
 'rotate':(9,22,0,2,0),'compress':(8,10,1,6,2),'abrade':(10,13,0,1,0),
 'pierce':(14,16,1,2,0),'shape':(9,17,0,3,0),
}
assert set(PROFILES) == set(states), 'Registry state has no generated pose'

def polygon_layer(image, points):
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    result = image.copy()
    result.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    return result, mask

def build_frame(image, state, phase, ref_height):
    source, swing, stride, lean, reach = PROFILES[state]
    wave = math.sin((phase+.25)*math.pi/2)
    # Normalize by idle art scale, preserving crouched pose height and identity.
    if source == -1:
        width = 47
        image = image.resize((width, round(image.height*width/image.width)), Image.Resampling.LANCZOS)
    else:
        scale = 72/ref_height
        image = image.resize((round(image.width*scale), round(image.height*scale)), Image.Resampling.LANCZOS)
    w,h = image.size
    x,y = (CELL_W-w)//2, 104-h
    base = Image.new('RGBA',(CELL_W,CELL_H))
    if state == 'sleep':
        breath=[(0,0),(1,1),(0,2),(-1,1)][phase]
        image = image.resize((w+breath[0], h+breath[1]),Image.Resampling.LANCZOS)
        base.alpha_composite(image,((CELL_W-image.width)//2,104-image.height))
        return base
    # Separate arms and legs from the full-body illustration. Their rotations
    # differ from the torso, so these are actual image frames, not whole-sprite bob.
    left, lm = polygon_layer(image,[(0,h*.24),(w*.32,h*.25),(w*.38,h*.67),(0,h*.73)])
    right, rm = polygon_layer(image,[(w*.66,h*.24),(w,h*.12),(w,h*.72),(w*.63,h*.67)])
    legs, legmask = polygon_layer(image,[(0,h*.73),(w,h*.73),(w,h),(0,h)])
    torso=image.copy()
    erase=ImageChops.lighter(ImageChops.lighter(lm,rm),legmask)
    torso.putalpha(ImageChops.subtract(image.getchannel('A'),erase))
    def put(part,angle,pivot,dx=0,dy=0):
        layer=Image.new('RGBA',(CELL_W,CELL_H));layer.alpha_composite(part,(x+dx,y+dy))
        layer=layer.rotate(angle,resample=Image.Resampling.BICUBIC,center=(x+pivot[0],y+pivot[1]))
        base.alpha_composite(layer)
    put(legs,stride*wave,(w*.5,h*.74))
    put(torso,lean*wave,(w*.5,h*.75),0,round(reach*wave*.5))
    put(left,swing*wave,(w*.27,h*.31),0,round(reach*wave))
    put(right,-swing*wave,(w*.72,h*.31),0,round(reach*wave))
    return base

sleep=Image.open(ASSETS/'medieval-sleep-atlas.png').convert('RGBA')
metadata=[]
for variant,name in enumerate(['blue','rust','green','linked']):
    atlas=Image.open(ASSETS/f'citizen-{name}-states.png').convert('RGBA')
    rows=math.ceil(len(states)*4/COLS)
    output=Image.new('RGBA',(COLS*CELL_W,rows*CELL_H))
    ref_height=layout[variant]['frames'][0]['h']
    ref_width=layout[variant]['frames'][0]['w']*72/ref_height
    for state_index,state in enumerate(states):
        pose=PROFILES[state][0]
        if pose==-1:
            cw,ch=sleep.width//2,sleep.height//2
            crop=sleep.crop(((variant%2)*cw,(variant//2)*ch,(variant%2+1)*cw,(variant//2+1)*ch))
            crop=crop.crop(crop.getbbox())
        else:
            f=layout[variant]['frames'][pose]
            crop=atlas.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']))
        for phase in range(4):
            frame=build_frame(crop,state,phase,ref_height)
            i=state_index*4+phase
            output.alpha_composite(frame,((i%COLS)*CELL_W,(i//COLS)*CELL_H))
    output.save(ASSETS/f'citizen-{name}-animated.png',optimize=True)
    metadata.append({'width':output.width,'height':output.height,'referenceWidth':round(ref_width,6)})
(ROOT/'site/citizen-animation-atlas.js').write_text('// Generated by scripts/build_citizen_animations.py; fixed cells keep the feet anchored.\nexport const ANIMATION_ATLAS='+json.dumps({'cellWidth':CELL_W,'cellHeight':CELL_H,'columns':COLS,'framesPerState':4,'states':states,'variants':metadata},separators=(',',':'))+';\n')
print(f'Generated {len(states)} states × 4 frames × 4 identities')
