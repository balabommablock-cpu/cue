const {join}=require('node:path');
// Keep the established Cue identity on upgrades. An early Community-only
// installation retains its own data folder; no account or notes are copied.
function dataDirectory(appData,exists){
  const main=join(appData,'Cue'),community=join(appData,'Cue Community');
  return exists(main)?main:exists(community)?community:main;
}
module.exports={dataDirectory};
