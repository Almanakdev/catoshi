Sushi Paws — drop-in cat models
==============================

By default the game builds its cat PROCEDURALLY from the primitives in
src/engine/prim.js (see src/cat/catModel.js). Nothing is downloaded, nothing
can 404, and the whole animal is about 18 draw calls. You do not need to put
anything in this folder.

If you would rather use your own cat, this is where it goes.


1. Drop the file here
---------------------
    public/models/cat.glb      (or cat.gltf, or cat.vrm)

Anything Vite serves from public/ is available at runtime under BASE_URL, so
the file above becomes:

    `${import.meta.env.BASE_URL}models/cat.glb`


2. Point the game at it
-----------------------
Add (or edit) src/config.js:

    // src/config.js
    export const CAT_MODEL_URL = `${import.meta.env.BASE_URL}models/cat.glb`;
    // export const CAT_MODEL_URL = null;   // <- procedural cat (the default)

and load the cat through catFromOptions():

    import { catFromOptions } from './cat/catLoader.js';
    import { CAT_MODEL_URL } from './config.js';
    import { makeToonGradient } from './engine/textures.js';

    const cat = await catFromOptions({
      url: CAT_MODEL_URL,            // null / undefined -> procedural
      targetHeight: 1.35,            // overall height in world units
      gradientMap: makeToonGradient(4),
      fur: '#e8a55c', hat: 'chef', apron: true,
    });
    scene.add(cat.group);

If CAT_MODEL_URL is null, or the file is missing / corrupt / fails to parse,
catFromOptions() logs which path it took and silently returns the procedural
cat instead. It never throws and never rejects, so a bad model file cannot
break the game.


3. What the loader does to your model
-------------------------------------
* Scales it uniformly so its total height matches `targetHeight`
  (default 1.35 world units — the procedural cat is 1.04 at the shoulder,
  1.28 to the ear tips and 1.46 nose-to-rump; ~3.6 units = one storey).
* Drops it so the lowest vertex sits exactly on y = 0.
* Turns on castShadow / receiveShadow for every mesh.
* If the file has animation clips, builds an AnimationMixer and maps the clip
  names to the game's action names CASE-INSENSITIVELY, ignoring spaces,
  underscores and mixamo-style prefixes. Recognised names (and some aliases):

      idle    (stand, breathing, rest)
      walk    (walking, trot, prowl)
      run     (running, sprint, gallop)
      jump    (leap, hop, jumpstart)
      fall    (falling, jumploop, inair)
      land    (landing, jumpend)
      sit     (sitting, sitdown)
      sleep   (sleeping, lie, laydown, nap)
      carry   (holding, pickup, deliver)
      cook    (chop, work, craft)
      fish    (paw, dab, dig)
      meow    (talk, speak, cry)
      stretch (yawn, wakeup)
      lick    (groom, clean, eat, drink)
      happy   (cheer, celebrate, dance)
      tired   (exhausted, sad)
      climb   (ladder)
      pounce  (attack, swipe, punch, scratch)

  Anything the model does not have degrades to a no-op: setAction() returns 0
  for a missing one-shot and falls back to idle for a missing pose, so the
  gameplay code never has to branch on which cat it got.
* If the file ends in .vrm it loads @pixiv/three-vrm dynamically and registers
  VRMLoaderPlugin (VRM 0.x models are auto-rotated to the VRM 1.0 facing).
  The VRM package stays out of the main bundle unless a .vrm is actually used.


4. Orientation
--------------
thirdPersonControls drives `group.rotation.y = atan2(move.x, move.z)`, so the
character's LOCAL +Z must be its forward direction. If your model faces the
other way it will moonwalk — fix it with:

    cat.setFacingOffset(Math.PI);

(The procedural cat is authored nose-toward +Z and needs no offset.)


5. Licensing
------------
Whatever you drop in here ships with your build. Make sure you have the right
to redistribute it, and keep the licence file next to the model.
