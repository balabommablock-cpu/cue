// A shortcut launch may arrive before the window or interview context loads.
// Deliver it once after the renderer explicitly says it is ready.
function createStartController({show,send}){
  let ready=false,pending=false;
  return {
    request(){pending=true;show();if(ready){pending=false;send('start-listening');}},
    ready(){ready=true;if(pending){pending=false;show();send('start-listening');}},
    loading(){ready=false;},
  };
}
module.exports={createStartController};
