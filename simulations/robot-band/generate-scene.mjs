// Geometry is kept procedural so stage dimensions and instrument placement are easy to edit.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const xml = [];
const add = line => xml.push(line);
const rgb = hex => `rgb(${hex.match(/../g).map(v => parseInt(v, 16)).join(', ')})`;
const surfaces = { floor: '10151f', stage: '232d3c', rim: '121923', black: '080d14', steel: '596879', white: 'e6edf3', mint: '54e5c0', gold: 'ffbe5c', purple: 'b89aff', red: 'e85e57', wood: 'b97941', drum: 'cb7047', keys: 'f6f2e8' };
function transform(x, y, z, rotation = '') {
  return `<Translation x="${x}m" y="${y}m" z="${z}m"/>${rotation ? `<Rotation ${rotation}/>` : ''}`;
}
function box(name, x, y, z, depth, width, height, surface, rotation = '') {
  add(`<BoxAppearance name="${name}" depth="${depth}m" width="${width}m" height="${height}m">${transform(x,y,z,rotation)}<Surface ref="${surface}"/></BoxAppearance>`);
}
function cylinder(name, x, y, z, radius, height, surface, rotation = '') {
  add(`<CylinderAppearance name="${name}" radius="${radius}m" height="${height}m">${transform(x,y,z,rotation)}<Surface ref="${surface}"/></CylinderAppearance>`);
}
function sphere(name, x, y, z, radius, surface) {
  add(`<SphereAppearance name="${name}" radius="${radius}m">${transform(x,y,z)}<Surface ref="${surface}"/></SphereAppearance>`);
}
function pole(name,x,y,z,height) { cylinder(name,x,y,z,.016,height,'steel'); }
function sign(name,x,y,z,width,height,texture) {
  const w=width/2, h=height/2;
  add(`<ComplexAppearance name="${name}">${transform(x,y,z)}<Surface albedo="rgb(255,255,255)" ambient="1" roughness="1" texture="assets/${texture}.png"/><Vertices>0 ${-w} ${-h} 0 ${w} ${-h} 0 ${w} ${h} 0 ${-w} ${h}</Vertices><TexCoords>0 0 1 0 1 1 0 1</TexCoords><Quads>0 1 2 3</Quads></ComplexAppearance>`);
}

add('<Simulation>');
add('<Include href="../../external/BHumanCodeRelease/Config/Scenes/Includes/K1/K1.rsi3"/>');
for (const [name,color] of Object.entries(surfaces)) add(`<Surface name="${name}" albedo="${rgb(color)}" roughness="0.75" ambient="0.65"/>`);
add('<Scene name="RobotBand" controller="RobotBandController" stepLength="0.002s" gravity="0m/s^2" bodyCollisions="false" color="rgb(17,22,32)">');
add('<PointLight x="3m" y="0m" z="5m" intensity="2.2" color="rgb(235,244,255)"/>');
add('<PointLight x="-1m" y="3m" z="2.5m" intensity="1.1" color="rgb(100,255,214)"/>');
add('<PointLight x="-1m" y="-3m" z="2.5m" intensity="1.0" color="rgb(190,155,255)"/>');

add('<Compound name="Stage">');
add('<BoxGeometry name="Ground" depth="18m" width="18m" height="0.1m"><Translation z="-0.06m"/></BoxGeometry>');
box('StudioFloor',0,0,-.02,18,18,.06,'floor');
box('Platform',0,0,.10,4.7,7.7,.20,'stage');
box('FrontFascia',2.36,0,.12,.055,7.7,.24,'rim');
box('DrummerRiser',-.55,1.85,.31,.85,.90,.22,'rim');
box('DrummerRiserEdge',-.116,1.85,.424,.016,.90,.015,'gold');
box('MintEdge',2.395,0,.235,.018,7.72,.025,'mint');
box('RearWall',-2.35,0,1.55,.16,7.7,2.7,'black');
sign('RobotBandBackdrop',-2.255,0,1.90,6.85,1.48,'backdrop');
for(let i=0;i<27;i++) {
  const y=-3.5+i*.27;
  box(`BackdropLED${i}`,-2.24,y,.63,.018,.055,.46+(i%5)*.065,i%2?'mint':'purple');
}
for(const y of [-3.57,3.57]) {
  cylinder(`Tower${y}`, -1.65,y,1.52,.045,2.64,'steel');
  box(`TowerFoot${y}`,-1.65,y,.25,.36,.36,.1,'black');
}
box('LightingTruss',-1.65,0,2.82,.10,7.25,.10,'steel');
for(let i=0;i<7;i++) {
  const y=-3+i;
  box(`LightHousing${i}`,-1.55,y,2.65,.23,.22,.19,'black');
  cylinder(`LightLens${i}`,-1.42,y,2.59,.073,.025,i%2?'gold':'mint','y="65degree"');
}
for(const y of [-3.29,3.29]) {
  box(`PA${y}`,1.05,y,.77,.48,.47,1.12,'black');
  for(const z of [.49,.93]) {
    cylinder(`Woofer${y}_${z}`,1.299,y,z,.16,.015,'steel','y="90degree"');
    cylinder(`Cone${y}_${z}`,1.310,y,z,.135,.02,'rim','y="90degree"');
    sphere(`DustCap${y}_${z}`,1.328,y,z,.042,'black');
  }
}
for(const [i,y] of [1.85,0,-1.85].entries()) {
  box(`PlayerMat${i}`,.1,y,.208,1.75,1.38,.016,'rim');
  box(`PlayerAccent${i}`,1.00,y,.222,.035,1.38,.018,['gold','mint','purple'][i]);
  sign(`RolePlate${i}`,2.400,y,.12,1.48,.20,['drums','guitar','keyboard'][i]);
  box(`Monitor${i}`,1.57,y,.35,.32,.43,.22,'black','y="-18degree"');
  box(`Cable${i}`,-1.14,y,.216,1.8,.014,.008,'black');
}
add('</Compound>');

add('<Compound name="Instruments">');
// Drum set, sized for the one-metre K1.
cylinder('KickShell',.10,1.85,.46,.245,.28,'drum','y="90degree"');
cylinder('KickSkin',.253,1.85,.46,.228,.013,'white','y="90degree"');
cylinder('KickPort',.264,1.93,.41,.049,.016,'black','y="90degree"');
for(const [i,y] of [1.57,2.13].entries()) {
  cylinder(`TomShell${i}`,-.02,y,.81,.135,.17,'drum');
  cylinder(`TomRim${i}`,-.02,y,.90,.143,.018,'steel');
  cylinder(`TomSkin${i}`,-.02,y,.913,.13,.008,'white');
}
cylinder('SnareShell',-.08,1.38,.68,.16,.13,'steel');
cylinder('SnareSkin',-.08,1.38,.752,.155,.009,'white');
for(const [i,y] of [1.23,2.48].entries()) {
  pole(`CymbalStand${i}`,-.03,y,.68,.91);
  cylinder(`Cymbal${i}`,-.03,y,1.14,.22,.013,'gold');
  sphere(`CymbalBell${i}`,-.03,y,1.15,.037,'gold');
  box(`CymbalFoot${i}`,-.03,y,.24,.30,.20,.025,'steel');
}
// Stylised electric guitar in front of the centre robot.
box('GuitarBody',.61,-.06,.79,.065,.26,.30,'wood','x="-18degree"');
sphere('GuitarLowerCurve',.61,-.09,.71,.13,'wood');
box('GuitarPickguard',.655,-.055,.80,.012,.17,.21,'black','x="-18degree"');
box('GuitarNeck',.62,.065,1.10,.045,.055,.48,'wood','x="-18degree"');
box('GuitarFretboard',.650,.065,1.10,.008,.045,.47,'black','x="-18degree"');
box('GuitarHeadstock',.62,.15,1.36,.055,.085,.12,'gold','x="-18degree"');
for(let i=0;i<6;i++) box(`String${i}`,.661,-.062+i*.014,.91,.003,.002,.44,'steel','x="-18degree"');
// Keyboard and stand.
box('KeyboardCase',.24,-1.85,.865,.30,1.04,.095,'black');
box('KeyboardControlPanel',.145,-1.85,.917,.095,1.0,.012,'rim');
for(let i=0;i<25;i++) {
  const y=-2.32+i*.039;
  box(`WhiteKey${i}`,.295,y,.919,.17,.037,.025,'keys');
  if([0,1,3,4,5].includes(i%7) && i<24) box(`BlackKey${i}`,.255,y+.019,.942,.088,.018,.024,'black');
}
for(const y of [-2.25,-1.45]) {
  pole(`KeyboardLeg${y}`,.24,y,.54,.64);
  box(`KeyboardFoot${y}`,.24,y,.232,.44,.055,.035,'steel');
}
// Small status screen on the keyboard.
box('KeyboardScreen',.146,-2.15,.928,.06,.14,.009,'mint');
add('</Compound>');

add('<Compound name="Band">');
for(const [i,[x,y,color]] of [[-.55,1.85,'orange'],[.30,0,'green'],[-.15,-1.85,'purple']].entries()) {
  add(`<Body ref="K1" name="bot-${i+1}"><Set name="TeamColor" value="${color}"/><Translation x="${x}m" y="${y}m" z="${i===0 ? .957 : .737}m"/></Body>`);
}
add('</Compound>\n</Scene>\n</Simulation>\n');
writeFileSync(fileURLToPath(new URL('RobotBand.ros3',import.meta.url)),xml.join('\n'));
console.log('RobotBand.ros3 generated: three K1, stage, drums, guitar and keyboard.');
