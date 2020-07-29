"use strict";

// Utility functions

/**
 * @function jsonHasChildrenArray checks whether jsonObj has a key-value pair
 *   where key is 'children' and value is an array.
 * @param {object} jsonObj in a json data structure.
 * @returns {boolean} true if it has a key-value pair
 *   where key is 'children' and value is an array; false otherwise.
 */
function jsonHasChildrenArray(jsonObj){
  return !$.isEmptyObject(jsonObj) &&
    jsonObj.hasOwnProperty('children') &&
    Array.isArray(jsonObj['children']);
}
/**
 * @function searchJsonArrayByName search for entry in the array with the target name.
 * @param {object} jsonArray is a json array.
 *   Its structure must be: [ {'name':<string>, 'children':[array], ...},
 *                            {'name':<string>, ...}]
 * @param {string} name is the name to search for.
 * @returns {object} one entry in jsonArray if its name matches. Otherwise null if none of the entries match.
 */
function searchJsonArrayByName(jsonArray, name){
  var res = null;
  for (let i = 0; i < jsonArray.length; i++){
    if (jsonArray[i]['name'] === name){ res = jsonArray[i]; break };
    if (jsonHasChildrenArray(jsonArray[i])) res = searchJsonArrayByName(jsonArray[i]['children'], name);
    if (res) break; // Return immediately if res is valid. Important for recursion.
  }
  return res;
}
/**
 * @function isFunction return true is the name indicates a function, return false otherwise.
 * @param {string} name is the name in question.
 */
function isFunction(name){
  if ( name.match(/\w+:\s+\w+/g) ) return true;
  else return false;
}
/**
 * @function isBasicBlock return true is the name indicates a basic block, return false otherwise.
 * @param {string} name is the name in question.
 */
function isBasicBlock(name){
  if ( name.match(/(Fused loop |Partially unrolled )?[\w<>]+\.B\d+.*/g) ) return true;
  else return false;
}
/**
 * @function getRealName returns the name of functions/blocks/loops without the prefix "kernel: "/"function: " etc.
 * @param {string} name is the name in question.
 * @returns {string} is the name without any prefix "kernel: "/"function: "/"Fused loop" ...
 */
function getRealName(name){
  let res = name;
  if ( isFunction(name) ){
    // "kernel: bb1"/"function: bb1"
    res = name.substring(name.indexOf(': ')+2);
  }else if (name.match(/^Fused loop \w+\.B\d+.*/g)){
    // Change:6087384 adds "Fused loop " in front of basic block names
    // Remove "Fused loop"
    res = name.substring(name.indexOf('Fused loop ')+11);
  }else if (name.match(/Partially unrolled \w+\.B\d+.*/g)){
    res = name.substring(name.indexOf('Partially unrolled ')+19);
  }
  return res;
}
/**
 * find the latency from scheduleJSON
 * returns -1 if fails to find the block
 */ 
function findLatency(blockName) {
  var latency = -1;
  var found = false;
  Object.keys(scheduleJSON).forEach( function(funcID) {
    var func = scheduleJSON[funcID];
    if (func.hasOwnProperty("nodes")) {
      func["nodes"].forEach( function(block) {
        if (block.name === blockName) {
          found = true;
          latency = block.end - block.start;
          return;
        }
      });
    }
    if (found) return;
  });
  return latency;
}
/**
 * @function findIdsAndPids extract the ID and parent ID info for functions and basic blocks.
 * @returns {object} is a json dictionary that contains ID and parent ID for functions and basic blocks.
 *   Structure: {name1: {'id':<int>, 'pid':<int>},
 *               name2: {'id':<int>, 'pid':<int>},
 *               ... }
 */
function findIdsAndPids(){
  let res = {};
  // Use info from loopsJSON (hierarchy info) and "funcOrderedBlock" (ID info).
  // Note: in "funcOrderedBlock", the function names have no prefix "Kernel: " etc.

  // Populate IDs first
  Object.keys(funcOrderedBlock).forEach( function(funcName){
    res[funcName] = {'id': funcOrderedBlock[funcName]['id'], 'pid': 0};
    funcOrderedBlock[funcName].children.forEach( function(bb){
      res[ bb['name'] ] = {'id': bb['id'], 'pid': 0};
    } );
  } );

  if ( jsonHasChildrenArray(loopsJSON) ){
    // This must be true: the first level children in loopsJSON are functions
    populatePid(loopsJSON['children'], 0);
  }

  function populatePid(nodeArray, pid){
    nodeArray.forEach( function(node){
      let realName = getRealName(node['name']);
      if ( res.hasOwnProperty(realName) ){
        res[realName]['pid'] = pid;
        if ( jsonHasChildrenArray(node) ) populatePid(node['children'], res[realName]['id']);
      }
    } );
  }
  return res;
}

/**
 * @function FPGALoop create a table containing loop information
 * @param {object} pDiv is the parent element that contains the table
 */
var FPGALoop = function(pDiv) {
  var vDiv = pDiv;
  var vID = 'loopAnalysis';
  var vBodyRef = vID + 'Body';
  var vName = "Loop Analysis";
  var vTable = null;
  var vIdInfo = findIdsAndPids();

  clearReportAndDetailsPane();
  function clearReportAndDetailsPane(){
    // remove the content of parent div
    while (vDiv.firstChild) vDiv.removeChild(vDiv.firstChild);
    clearDivContent();
  }

  // Print a message when there is no loop table shown yet
  let fpgaloopTextMsg = document.createElement("P");
  fpgaloopTextMsg.className = "fpgaloop-info-text";
  fpgaloopTextMsg.innerText = "Click on a " + function_prefix + " or block to see the loop pipeline information.";
  createCard(vDiv, vID, vName, 'fpgaloop-card', fpgaloopTextMsg);

  this.draw = function(data) {
    clearReportAndDetailsPane();

    var treeNode = data.node.data;

    vTable = new FPGADataTable(vID+'Table');
    vTable.setShowName(1);
    vTable.setShowLoc(1);
    vTable.setShowCaption(0);
    vTable.setTranpose(0);
    vTable.setClass('table table-bordered fpgaloop-table fpgaloop-hover-row');
    vTable.setColumnList('Pipelined', 'II', 'Scheduled fMAX', 'Latency',
      'Speculated Iterations',
      'Max Interleaving Iterations',
      'Brief Info');
    vTable.setAttributeMap({
      'Pipelined': 'pipelined',
      'II': 'ii',
      'Scheduled fMAX': 'achievedFmax',
      'Max Interleaving Iterations': 'maxInterleaving',
      'Latency': 'latency',
      'Speculated Iterations': 'si',
      'Brief Info': 'brief'});

    let json2parse = null;
    let loopDataRows = [];
    if (jsonHasChildrenArray(loopsJSON)) json2parse = searchJsonArrayByName(loopsJSON['children'], treeNode.name);

    if (json2parse){
      parseJson(json2parse, true);

      /**
       * @function parseJson parses a json dictionary structure and writes results into loopDataRows
       * @param {object} json is a json dictionary structure found in loopsJSON:
       *   { 'name':<string>,
       *     'data': [<int>, <int>, <int>],
       *      'details': [],
       *      'children': {...} }
       * @param {boolean} isFirstRow indicates whether this node will be the first row in the loops table
       */
      function parseJson(json, isFirstRow){
        // Do not show fictitious nodes
        let realName = getRealName(json['name']);
        if (!vIdInfo.hasOwnProperty(realName)) return;

        let columns = {};
        columns['pipelined'] = json['data'][0];
        columns['ii'] = json['data'][1];
        columns['si'] = json['data'][2];
        columns['brief'] = (json.hasOwnProperty('details') && json['details'][0]['type']==="brief") ?
          json['details'][0]['text']: "";

        let noteCall = 'clearDivContent()';
        if ( json.hasOwnProperty('details') ){
          let detailHTML = getHTMLDetailsFromJSON(json['details'], json['name']);
          noteCall = 'changeDivContent(0,' + JSON.stringify(detailHTML) + ')';
        }

        let debugLoc = null;
        let secondaryName = "";
        if (json.hasOwnProperty('debug') && json['debug'][0][0]['line']){
          debugLoc = json['debug'];
        }else{
          secondaryName = " (" + json['debug'][0][0]['filename'] + ")";
        }

        //correlate loopsJSON and fmax_iiJSON only when we are parsing basic blocks from loopsJSON
        if ( isBasicBlock(json['name'])
          && !$.isEmptyObject(fmax_iiJSON)
          && fmax_iiJSON.hasOwnProperty('basicblocks')
          && fmax_iiJSON.basicblocks.hasOwnProperty(realName) ){
          let bbJson = fmax_iiJSON['basicblocks'][realName];
          columns['achievedFmax'] = bbJson['achieved_fmax'];
          columns['maxInterleaving'] = bbJson['max_interleaving'];
          // Workaround Find the latency based on name based on block_info.name in schedule.json
          var blockLatency = findLatency(realName);
          columns['latency'] = (blockLatency < 0) ? "Unknown" : blockLatency.toString();  // Error handling
        }

        if (columns['pipelined'] === "No"){
          columns['ii'] = "n/a";
          columns['si'] = "n/a";
          columns['maxInterleaving'] = "n/a";
        }

        let rowId = vIdInfo[realName]['id'];
        let rowPid = isFirstRow? 0: vIdInfo[realName]['pid'];
        loopDataRows.push( new FPGADataRow(rowId, json['name']+secondaryName, debugLoc, columns, '', rowPid, 0, '', noteCall, '') );

        if ( jsonHasChildrenArray(json) ){
          json['children'].forEach(function (child){
            parseJson(child, false);
          });
        }
      }
    }

    if (loopDataRows.length > 0) {
      loopDataRows.forEach(function (loopRow) {
        vTable.addRow(loopRow);
      });
      createCard(vDiv, vID, vName, 'fpgaloop-card', vTable.draw());
    }else{
      fpgaloopTextMsg.innerText = "No information found for this node.";
      createCard(vDiv, vID, vName, 'fpgaloop-card', fpgaloopTextMsg);
    }
  }
}

