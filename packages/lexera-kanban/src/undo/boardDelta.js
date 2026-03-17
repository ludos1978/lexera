(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraBoardDelta = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cloneJson(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function computeBoardDelta(oldBoard, newBoard) {
    var delta = {};
    var scalarKeys = ['valid', 'title', 'yamlHeader', 'kanbanFooter'];
    for (var k = 0; k < scalarKeys.length; k++) {
      var key = scalarKeys[k];
      if (oldBoard[key] !== newBoard[key]) {
        delta[key] = { o: oldBoard[key], n: newBoard[key] };
      }
    }
    var oldSettings = oldBoard.boardSettings || null;
    var newSettings = newBoard.boardSettings || null;
    var settingsDelta = diffFlatObject(oldSettings, newSettings);
    if (settingsDelta) delta.boardSettings = settingsDelta;
    var rowsDelta = diffIdArray(oldBoard.rows || [], newBoard.rows || [], diffRow);
    if (rowsDelta) delta.rows = rowsDelta;
    var colsDelta = diffIdArray(oldBoard.columns || [], newBoard.columns || [], diffColumn);
    if (colsDelta) delta.columns = colsDelta;
    return delta;
  }

  function diffFlatObject(oldObj, newObj) {
    if (oldObj === newObj) return null;
    if (!oldObj && !newObj) return null;
    if (!oldObj) return { __replaced: { o: null, n: cloneJson(newObj) } };
    if (!newObj) return { __replaced: { o: cloneJson(oldObj), n: null } };
    var diff = null;
    var allKeys = {};
    var k;
    for (k in oldObj) allKeys[k] = true;
    for (k in newObj) allKeys[k] = true;
    for (k in allKeys) {
      var ov = oldObj[k];
      var nv = newObj[k];
      if (ov !== nv) {
        if (!diff) diff = {};
        diff[k] = { o: ov, n: nv };
      }
    }
    return diff;
  }

  function diffIdArray(oldArr, newArr, diffItemFn) {
    var oldIds = oldArr.map(function (item) { return item.id; });
    var newIds = newArr.map(function (item) { return item.id; });
    var oldMap = {};
    var newMap = {};
    var result = null;
    var i;
    for (i = 0; i < oldArr.length; i++) oldMap[oldArr[i].id] = oldArr[i];
    for (i = 0; i < newArr.length; i++) newMap[newArr[i].id] = newArr[i];
    var orderChanged = oldIds.length !== newIds.length || oldIds.some(function (id, idx) {
      return id !== newIds[idx];
    });
    if (orderChanged) {
      result = result || {};
      result.oldOrder = oldIds;
      result.newOrder = newIds;
    }
    for (i = 0; i < newArr.length; i++) {
      if (!oldMap[newArr[i].id]) {
        result = result || {};
        if (!result.added) result.added = {};
        result.added[newArr[i].id] = cloneJson(newArr[i]);
      }
    }
    for (i = 0; i < oldArr.length; i++) {
      if (!newMap[oldArr[i].id]) {
        result = result || {};
        if (!result.removed) result.removed = {};
        result.removed[oldArr[i].id] = cloneJson(oldArr[i]);
      }
    }
    for (i = 0; i < newArr.length; i++) {
      if (oldMap[newArr[i].id]) {
        var itemDelta = diffItemFn(oldMap[newArr[i].id], newArr[i]);
        if (itemDelta) {
          result = result || {};
          if (!result.modified) result.modified = {};
          result.modified[newArr[i].id] = itemDelta;
        }
      }
    }
    return result;
  }

  function diffRow(oldRow, newRow) {
    var delta = null;
    if (oldRow.title !== newRow.title) {
      delta = delta || {};
      delta.title = { o: oldRow.title, n: newRow.title };
    }
    var stacksDelta = diffIdArray(oldRow.stacks || [], newRow.stacks || [], diffStack);
    if (stacksDelta) {
      delta = delta || {};
      delta.stacks = stacksDelta;
    }
    return delta;
  }

  function diffStack(oldStack, newStack) {
    var delta = null;
    if (oldStack.title !== newStack.title) {
      delta = delta || {};
      delta.title = { o: oldStack.title, n: newStack.title };
    }
    var colsDelta = diffIdArray(oldStack.columns || [], newStack.columns || [], diffColumn);
    if (colsDelta) {
      delta = delta || {};
      delta.columns = colsDelta;
    }
    return delta;
  }

  function diffColumn(oldCol, newCol) {
    var delta = null;
    if (oldCol.title !== newCol.title) {
      delta = delta || {};
      delta.title = { o: oldCol.title, n: newCol.title };
    }
    var oldSrc = oldCol.include_source ? JSON.stringify(oldCol.include_source) : null;
    var newSrc = newCol.include_source ? JSON.stringify(newCol.include_source) : null;
    if (oldSrc !== newSrc) {
      delta = delta || {};
      delta.include_source = { o: oldCol.include_source || null, n: newCol.include_source || null };
    }
    var cardsDelta = diffIdArray(oldCol.cards || [], newCol.cards || [], diffCard);
    if (cardsDelta) {
      delta = delta || {};
      delta.cards = cardsDelta;
    }
    return delta;
  }

  function diffCard(oldCard, newCard) {
    var delta = null;
    var cardFields = ['content', 'checked', 'kid'];
    for (var f = 0; f < cardFields.length; f++) {
      var field = cardFields[f];
      if (oldCard[field] !== newCard[field]) {
        delta = delta || {};
        delta[field] = { o: oldCard[field], n: newCard[field] };
      }
    }
    return delta;
  }

  function applyBoardDelta(board, delta, reverse) {
    var scalarKeys = ['valid', 'title', 'yamlHeader', 'kanbanFooter'];
    for (var k = 0; k < scalarKeys.length; k++) {
      var key = scalarKeys[k];
      if (delta[key]) {
        board[key] = reverse ? delta[key].o : delta[key].n;
      }
    }
    if (delta.boardSettings) {
      applyFlatObjectDelta(board, 'boardSettings', delta.boardSettings, reverse);
    }
    if (delta.rows) {
      board.rows = applyIdArrayDelta(board.rows || [], delta.rows, reverse, applyRowDelta);
    }
    if (delta.columns) {
      board.columns = applyIdArrayDelta(board.columns || [], delta.columns, reverse, applyColumnDelta);
    }
  }

  function applyFlatObjectDelta(parent, prop, diff, reverse) {
    if (diff.__replaced) {
      parent[prop] = reverse ? cloneJson(diff.__replaced.o) : cloneJson(diff.__replaced.n);
      return;
    }
    if (!parent[prop]) parent[prop] = {};
    for (var k in diff) {
      parent[prop][k] = reverse ? diff[k].o : diff[k].n;
    }
  }

  function applyIdArrayDelta(arr, delta, reverse, applyItemDeltaFn) {
    var map = {};
    var i;
    for (i = 0; i < arr.length; i++) map[arr[i].id] = arr[i];
    var toRemove = reverse ? delta.added : delta.removed;
    if (toRemove) {
      for (var rid in toRemove) delete map[rid];
    }
    var toAdd = reverse ? delta.removed : delta.added;
    if (toAdd) {
      for (var aid in toAdd) map[aid] = cloneJson(toAdd[aid]);
    }
    if (delta.modified) {
      for (var mid in delta.modified) {
        if (map[mid]) {
          applyItemDeltaFn(map[mid], delta.modified[mid], reverse);
        }
      }
    }
    var targetOrder = reverse ? (delta.oldOrder || delta.newOrder) : (delta.newOrder || delta.oldOrder);
    if (targetOrder) {
      var result = [];
      for (i = 0; i < targetOrder.length; i++) {
        if (map[targetOrder[i]]) result.push(map[targetOrder[i]]);
      }
      return result;
    }
    return arr.filter(function (item) {
      return !!map[item.id];
    }).concat(Object.keys(map).filter(function (id) {
      return !arr.some(function (item) { return item.id === id; });
    }).map(function (id) {
      return map[id];
    }));
  }

  function applyRowDelta(row, delta, reverse) {
    if (delta.title) row.title = reverse ? delta.title.o : delta.title.n;
    if (delta.stacks) {
      row.stacks = applyIdArrayDelta(row.stacks || [], delta.stacks, reverse, applyStackDelta);
    }
  }

  function applyStackDelta(stack, delta, reverse) {
    if (delta.title) stack.title = reverse ? delta.title.o : delta.title.n;
    if (delta.columns) {
      stack.columns = applyIdArrayDelta(stack.columns || [], delta.columns, reverse, applyColumnDelta);
    }
  }

  function applyColumnDelta(col, delta, reverse) {
    if (delta.title) col.title = reverse ? delta.title.o : delta.title.n;
    if (delta.include_source) col.include_source = reverse ? delta.include_source.o : delta.include_source.n;
    if (delta.cards) {
      col.cards = applyIdArrayDelta(col.cards || [], delta.cards, reverse, applyCardDelta);
    }
  }

  function applyCardDelta(card, delta, reverse) {
    var cardFields = ['content', 'checked', 'kid'];
    for (var f = 0; f < cardFields.length; f++) {
      var field = cardFields[f];
      if (delta[field]) {
        card[field] = reverse ? delta[field].o : delta[field].n;
      }
    }
  }

  function estimateDeltaSize(delta) {
    return JSON.stringify(delta).length;
  }

  return {
    computeBoardDelta: computeBoardDelta,
    diffFlatObject: diffFlatObject,
    diffIdArray: diffIdArray,
    diffRow: diffRow,
    diffStack: diffStack,
    diffColumn: diffColumn,
    diffCard: diffCard,
    applyBoardDelta: applyBoardDelta,
    applyFlatObjectDelta: applyFlatObjectDelta,
    applyIdArrayDelta: applyIdArrayDelta,
    applyRowDelta: applyRowDelta,
    applyStackDelta: applyStackDelta,
    applyColumnDelta: applyColumnDelta,
    applyCardDelta: applyCardDelta,
    estimateDeltaSize: estimateDeltaSize
  };
}));
