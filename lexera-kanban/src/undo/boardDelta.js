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
    return structuredClone(value);
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

  /**
   * Translate a board delta into a list of refresh targets compatible with
   * refreshTargetedElements. Returns null to mean "caller should fall back
   * to a full render" (for any change the targeted pipeline can't express,
   * or when an id can't be resolved).
   *
   * Strategy: walk delta.rows top-down and emit the coarsest target that
   * covers the scope of the change at each level:
   *   - Board scalar / boardSettings → null (full)
   *   - Row append/remove-last → {type:'row-insert'|'row-remove',...}
   *   - Other row add/remove/reorder → null (full)
   *   - Row title change, stack add/remove/reorder → {type:'row',...}
   *   - Stack title change, column add/remove/reorder → {type:'stack',...}
   *   - Column title/include_source change, card add/remove/reorder → {type:'column',...}
   *   - Card content/checked/kid changes only → {type:'card-content',...} per card
   *
   * Row/stack targets use DISPLAY indices (positions in activeBoardData.rows),
   * column targets use the FULL flat column index (col.index from activeBoardData),
   * card-content targets use the VISIBLE card index within the column.
   *
   * @param {Object} delta - board delta (from computeBoardDelta)
   * @param {Object} activeBoardData - current flat display view
   * @returns {Array|null}
   */
  function deltaToTargets(delta, activeBoardData) {
    if (!delta || typeof delta !== 'object') return null;
    if (!activeBoardData) return null;

    // Board-level bail conditions: anything that affects more than one row
    // or the board's own chrome → fall back to full render.
    var scalarKeys = ['valid', 'title', 'yamlHeader', 'kanbanFooter'];
    for (var k = 0; k < scalarKeys.length; k++) {
      if (delta[scalarKeys[k]]) return null;
    }
    if (delta.boardSettings) return null;
    var hasRowShapeChange = !!(delta.rows && _hasArrayShapeChange(delta.rows));
    if (delta.columns && _hasArrayShapeChange(delta.columns)) return null;

    // If nothing modified, nothing to do
    var hasRowMods = delta.rows && delta.rows.modified;
    var hasColMods = delta.columns && delta.columns.modified;
    if (!hasRowShapeChange && !hasRowMods && !hasColMods) return null;

    // Build id→location maps from activeBoardData.
    // Any delta id that can't be found here means the change touches a
    // currently-hidden entity; safest to bail to full render.
    var maps = _buildIdMaps(activeBoardData);

    var targets = [];
    var seen = {};
    function emit(t) {
      var key = t.type + '|' + (t.rowIndex == null ? '' : t.rowIndex)
        + '|' + (t.stackIndex == null ? '' : t.stackIndex)
        + '|' + (t.colIndex == null ? '' : t.colIndex)
        + '|' + (t.cardIndex == null ? '' : t.cardIndex);
      if (seen[key]) return;
      seen[key] = true;
      targets.push(t);
    }

    if (hasRowShapeChange) {
      var rowShapeTarget = _rowShapeDeltaToTarget(delta.rows, maps);
      if (!rowShapeTarget) return null;
      emit(rowShapeTarget);
    }

    // Walk delta.rows.modified
    if (hasRowMods) {
      for (var rowId in delta.rows.modified) {
        var rowD = delta.rows.modified[rowId];
        var rowIdx = maps.rowIdToDisplayIdx[String(rowId)];
        if (rowIdx == null) return null; // row hidden / unknown

        // Row title change alone → rebuild the row
        if (rowD.title) {
          emit({ type: 'row', rowIndex: rowIdx });
          continue;
        }
        if (!rowD.stacks) continue;
        if (_hasArrayShapeChange(rowD.stacks)) {
          // Stack add/remove/reorder — rebuild the row
          emit({ type: 'row', rowIndex: rowIdx });
          continue;
        }
        if (!rowD.stacks.modified) continue;

        for (var stackId in rowD.stacks.modified) {
          var stackD = rowD.stacks.modified[stackId];
          var stackLoc = maps.stackIdToLoc[String(stackId)];
          if (!stackLoc) return null;

          if (stackD.title) {
            emit({ type: 'stack', rowIndex: stackLoc.rowIdx, stackIndex: stackLoc.stackIdx });
            continue;
          }
          if (!stackD.columns) continue;
          if (_hasArrayShapeChange(stackD.columns)) {
            // Column add/remove/reorder within stack — rebuild the stack
            emit({ type: 'stack', rowIndex: stackLoc.rowIdx, stackIndex: stackLoc.stackIdx });
            continue;
          }
          if (!stackD.columns.modified) continue;

          for (var colId in stackD.columns.modified) {
            var colD = stackD.columns.modified[colId];
            var colIdStr = String(colId);
            var colFlatIdx = maps.colIdToFlatIdx[colIdStr];
            if (colFlatIdx == null) return null;

            if (colD.title || colD.include_source) {
              emit({ type: 'column', colIndex: colFlatIdx });
              continue;
            }
            if (!colD.cards) continue;
            if (_hasArrayShapeChange(colD.cards)) {
              // Card add/remove/reorder — rebuild the whole column.
              // (Per-card insert/remove targets would be faster but the
              // index arithmetic across multiple ops in one delta is
              // fragile; column rebuild is simpler and still very fast.)
              emit({ type: 'column', colIndex: colFlatIdx });
              continue;
            }
            if (!colD.cards.modified) continue;

            // Pure content/checked/kid changes on existing cards → per-card targets
            var cardMap = maps.colIdToCardMap[colIdStr] || {};
            var bailToColumn = false;
            var cardTargets = [];
            for (var cardId in colD.cards.modified) {
              var cardIdx = cardMap[String(cardId)];
              if (cardIdx == null) {
                // Card is hidden or missing from visible view — rebuild the column
                bailToColumn = true;
                break;
              }
              cardTargets.push({ type: 'card-content', colIndex: colFlatIdx, cardIndex: cardIdx });
            }
            if (bailToColumn) {
              emit({ type: 'column', colIndex: colFlatIdx });
            } else {
              for (var ci = 0; ci < cardTargets.length; ci++) emit(cardTargets[ci]);
            }
          }
        }
      }
    }

    // Legacy path: if only delta.columns exists (no rows), walk it too.
    // In practice, migrated boards never have delta.columns, but keep this
    // for robustness.
    if (!hasRowMods && hasColMods) {
      for (var colId2 in delta.columns.modified) {
        var colD2 = delta.columns.modified[colId2];
        var colIdStr2 = String(colId2);
        var colFlatIdx2 = maps.colIdToFlatIdx[colIdStr2];
        if (colFlatIdx2 == null) return null;

        if (colD2.title || colD2.include_source) {
          emit({ type: 'column', colIndex: colFlatIdx2 });
          continue;
        }
        if (!colD2.cards) continue;
        if (_hasArrayShapeChange(colD2.cards)) {
          emit({ type: 'column', colIndex: colFlatIdx2 });
          continue;
        }
        if (!colD2.cards.modified) continue;

        var cardMap2 = maps.colIdToCardMap[colIdStr2] || {};
        var bail2 = false;
        var cardT2 = [];
        for (var cardId2 in colD2.cards.modified) {
          var cardIdx2 = cardMap2[String(cardId2)];
          if (cardIdx2 == null) { bail2 = true; break; }
          cardT2.push({ type: 'card-content', colIndex: colFlatIdx2, cardIndex: cardIdx2 });
        }
        if (bail2) emit({ type: 'column', colIndex: colFlatIdx2 });
        else for (var ci2 = 0; ci2 < cardT2.length; ci2++) emit(cardT2[ci2]);
      }
    }

    return targets.length > 0 ? targets : null;
  }

  /**
   * Check if an idArray delta contains any structural shape change
   * (added, removed, or explicit reorder).
   */
  function _hasArrayShapeChange(idArrayDelta) {
    if (!idArrayDelta) return false;
    return !!(idArrayDelta.added || idArrayDelta.removed
      || idArrayDelta.oldOrder || idArrayDelta.newOrder);
  }

  function _isHiddenForTargeting(text) {
    return /(^|\s)#hidden(?:-internal-[a-z0-9-]+)?\b/i.test(String(text || ''));
  }

  function _rowShapeDeltaToTarget(rowDelta, maps) {
    if (!rowDelta || rowDelta.modified) return null;
    var added = rowDelta.added || null;
    var removed = rowDelta.removed || null;
    var addedIds = added ? Object.keys(added) : [];
    var removedIds = removed ? Object.keys(removed) : [];

    if (addedIds.length === 1 && removedIds.length === 0 && Array.isArray(rowDelta.newOrder)) {
      var addedId = String(addedIds[0]);
      var addedRow = added[addedId] || null;
      if (_isHiddenForTargeting(addedRow && addedRow.title)) return null;
      var newDisplayIdx = 0;
      for (var ni = 0; ni < rowDelta.newOrder.length; ni++) {
        var nextId = String(rowDelta.newOrder[ni]);
        if (nextId === addedId) break;
        if (maps.rowIdToDisplayIdx[nextId] != null) newDisplayIdx++;
        else if (added[nextId] && !_isHiddenForTargeting(added[nextId] && added[nextId].title)) newDisplayIdx++;
      }
      if (newDisplayIdx === maps.visibleRowCount) {
        return { type: 'row-insert', rowIndex: newDisplayIdx, rowId: addedId };
      }
      return null;
    }

    if (removedIds.length === 1 && addedIds.length === 0) {
      var removedId = String(removedIds[0]);
      var oldDisplayIdx = maps.rowIdToDisplayIdx[removedId];
      if (oldDisplayIdx == null) return null;
      if (oldDisplayIdx === maps.visibleRowCount - 1) {
        return { type: 'row-remove', rowIndex: oldDisplayIdx, rowId: removedId };
      }
    }

    return null;
  }

  /**
   * Build id→index lookup maps from activeBoardData, matching the index
   * conventions that refreshTargetedElements expects:
   *   - rowIdToDisplayIdx: rowId → position in activeBoardData.rows
   *   - stackIdToLoc: stackId → {rowIdx, stackIdx} (display positions)
   *   - colIdToFlatIdx: columnId → full flat col index (col.index)
   *   - colIdToCardMap: columnId → {cardId → visible card index}
   */
  function _buildIdMaps(activeBoardData) {
    var maps = {
      rowIdToDisplayIdx: {},
      stackIdToLoc: {},
      colIdToFlatIdx: {},
      colIdToCardMap: {},
      visibleRowCount: 0
    };
    var rows = (activeBoardData.rows || []);
    maps.visibleRowCount = rows.length;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (row && row.id != null) maps.rowIdToDisplayIdx[String(row.id)] = r;
      var stacks = (row && row.stacks) || [];
      for (var s = 0; s < stacks.length; s++) {
        var stack = stacks[s];
        if (stack && stack.id != null) {
          maps.stackIdToLoc[String(stack.id)] = { rowIdx: r, stackIdx: s };
        }
        var cols = (stack && stack.columns) || [];
        for (var c = 0; c < cols.length; c++) {
          var col = cols[c];
          if (!col || col.id == null) continue;
          var colIdStr = String(col.id);
          // col.index is the full flat index assigned by updateDisplayFromFullBoard
          maps.colIdToFlatIdx[colIdStr] = (typeof col.index === 'number') ? col.index : -1;
          var cardMap = {};
          var cards = col.cards || [];
          for (var ci = 0; ci < cards.length; ci++) {
            if (cards[ci] && cards[ci].id != null) cardMap[String(cards[ci].id)] = ci;
          }
          maps.colIdToCardMap[colIdStr] = cardMap;
        }
      }
    }
    return maps;
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
    estimateDeltaSize: estimateDeltaSize,
    deltaToTargets: deltaToTargets
  };
}));
