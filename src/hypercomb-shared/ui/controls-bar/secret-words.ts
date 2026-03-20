// Deterministic two-word tag from a secret string.
// ~256 adjectives × ~256 nouns = 65 536 combinations.

const ADJECTIVES = [
  'amber','ancient','arctic','ashen','azure','bitter','blazing','blind',
  'bold','brave','bright','broad','broken','bronze','calm','carved',
  'cedar','clear','clever','cold','coral','covert','crisp','cross',
  'cruel','crystal','curled','damp','dark','dawn','deep','dense',
  'dim','distant','double','dreary','drift','driven','dry','dull',
  'dusk','dusted','eager','early','eastern','elder','ember','empty',
  'equal','eternal','even','faded','faint','fallen','far','fast',
  'feral','fierce','final','first','fixed','flat','fleet','flint',
  'fluid','foggy','fond','foreign','forked','fossil','found','fourth',
  'fragile','free','fresh','frigid','fringe','frost','frozen','full',
  'gentle','gilded','glass','golden','grand','granite','gray','green',
  'grim','ground','grown','guarded','half','hallow','hard','harsh',
  'hazel','heavy','hidden','high','hollow','humble','hushed','idle',
  'inner','iron','ivory','jagged','keen','kind','laced','large',
  'last','late','lavish','lean','light','limber','linen','linked',
  'liquid','little','live','local','lone','long','lost','loud',
  'low','lucid','lunar','marble','marked','marsh','meager','mellow',
  'merged','mild','mint','misty','molten','moored','mossy','muted',
  'naked','narrow','native','near','nested','nimble','noble','north',
  'numb','oaken','odd','olive','onyx','open','optic','orchid',
  'outer','oval','oxide','pale','paper','past','pearl','plain',
  'pliant','plume','polar','polled','prime','proud','pure','quartz',
  'queen','quick','quiet','rare','ragged','rapid','raven','raw',
  'ready','regal','remote','rigid','ripe','risen','river','roaming',
  'rocky','rooted','rough','round','royal','rugged','rustic','sacred',
  'sage','salted','sandy','scarlet','sealed','second','serene','seven',
  'shadow','shallow','sharp','sheer','shell','shield','short','shroud',
  'silent','silk','silver','simple','sixth','slate','sleek','slender',
  'slight','slow','small','smooth','soft','solar','solid','somber',
  'south','spare','spiral','split','stark','steady','steel','steep',
  'still','stone','stout','strong','subtle','sunken','sure','sweet',
  'swift','tall','tawny','thick','thin','third','tidal','tight',
]

const NOUNS = [
  'arch','arrow','basin','beacon','blade','blaze','bloom','bluff',
  'bone','book','branch','brass','break','breeze','brick','bridge',
  'brook','brush','cairn','candle','canyon','cape','cedar','chain',
  'chalk','chapel','chord','cinder','circle','citrus','cliff','cloud',
  'clover','coast','cobalt','coin','column','compass','cove','crane',
  'creek','crest','cross','crown','crystal','current','curve','dale',
  'delta','depth','desert','dew','dome','door','drift','drum',
  'dune','dust','eagle','earth','echo','edge','elm','ember',
  'engine','eye','falcon','fallow','feather','fence','fern','ferry',
  'field','finch','fire','fjord','flame','flare','flax','flint',
  'flora','flux','foam','forge','fossil','frost','furrow','garden',
  'garnet','gate','glade','glass','glen','globe','gorge','grain',
  'granite','grove','gull','harbor','haven','hawk','hearth','hedge',
  'heron','hinge','hollow','horizon','horn','husk','inlet','iron',
  'island','ivory','jasper','jewel','juniper','keel','kiln','knoll',
  'lace','lagoon','lake','lantern','larch','latch','laurel','lava',
  'leaf','ledge','lemon','light','lily','linen','link','loft',
  'lotus','lynx','maple','marble','marsh','mason','meadow','mesa',
  'mill','mineral','mirror','mist','moon','moss','moth','mound',
  'nectar','node','north','notch','oak','oar','ocean','olive',
  'onyx','orbit','orchid','osprey','oxbow','palm','parch','pass',
  'patch','path','peak','pearl','pebble','perch','petal','pier',
  'pillar','pine','pivot','plank','plume','point','pollen','pond',
  'poplar','port','prairie','prism','pulse','quartz','quay','rafter',
  'rain','range','rapid','ravine','realm','reed','reef','ridge',
  'rift','ring','river','road','robin','root','rose','rune',
  'sage','sand','scale','scar','scarab','seed','shade','shaft',
  'shell','shore','shrub','silo','silver','slate','slope','snow',
  'socket','soil','spark','spire','spoke','spring','spruce','spur',
  'star','steel','stem','steppe','stone','storm','strait','strand',
  'stream','summit','surge','swan','tarn','temple','terra','thorn',
  'tide','timber','torch','tower','trail','trench','tundra','vale',
  'vault','veil','verge','vine','vista','wane','ward','watch',
  'water','wave','wheat','willow','wind','wing','wolf','wood',
  'wren','yard','yew','zenith',
]

/** Deterministic two-word tag from a secret. Same secret → same words, always. */
export function secretTag(secret: string): string {
  // FNV-1a 32-bit
  let h = 0x811c9dc5
  for (let i = 0; i < secret.length; i++) {
    h ^= secret.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const bits = h >>> 0
  const adj = ADJECTIVES[bits & 0xFF]
  const noun = NOUNS[(bits >>> 8) & 0xFF]
  return `${adj} ${noun}`
}
