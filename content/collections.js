/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Snowl.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Myk Melez <myk@mozilla.org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

// modules that come with Firefox

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/opml.js");

let CollectionsView = {
  _log: null,

  get _tree() {
    delete this._tree;
    return this._tree = document.getElementById("sourcesView");
  },

  get _children() {
    delete this._children;
    return this._children = document.getElementById("sourcesViewChildren");
  },


  //**************************************************************************//
  // Initialization & Destruction

  init: function() {
    this._log = Log4Moz.repository.getLogger("Snowl.Sidebar");
    Observers.add("snowl:source:added", this.onSourceAdded, this);
    Observers.add("snowl:message:added", this.onMessageAdded, this);
    Observers.add("snowl:messages:changed", this.onMessagesComplete, this);

    // Intialize places 
    SnowlPlaces.init();
    if (!this._tree.hasAttribute("flat"))
      this._tree.setAttribute("flat", true);

    // Get collections and convert to places tree - one time upgrade
    if (!SnowlPlaces.convertedToPlaces) {
      this._getCollections();
      this._buildCollectionTree();
    }

    let query = this._tree.getAttribute("flat") == "true" ?
        SnowlPlaces.queryFlat : SnowlPlaces.queryGrouped;
    this._tree.place = query;

    // Ensure collection selection maintained, if in List sidebar
    if (document.getElementById("snowlSidebar") && SnowlUtils.gListViewCollectionItemIds)
      this._tree.selectItems(SnowlUtils.gListViewCollectionItemIds);
  },


  //**************************************************************************//
  // Event & Notification Handlers

  onSourceAdded: function() {
    // Newly subscribed source has been added to places, select the inserted row.
    // The tree may not be ready, so use a timeout.  The effect of selecting here
    // is that onMessageAdded will trigger a list view refresh for each message,
    // so messages pop into the list as added.
    this._tree.view.selection.select(-1);
    this._tree.currentSelectedIndex = this._tree.currentIndex;
    setTimeout(function() {
      SnowlUtils.gListViewDeleteMoveInsert = true;
      SnowlUtils.RestoreSelection(CollectionsView._tree,
                                  SnowlUtils.gListViewCollectionItemIds);
    }, 300)
  },

  onMessageAdded: function(aMessageObj) {
    // Determine if source or author of new message is currently selected in the
    // collections list; if so refresh list view.  Tree may not be ready, so must
    // use a timeout.
    let query, uri, rangeFirst = { }, rangeLast = { }, refreshFlag = false;

    setTimeout(function() {
      let numRanges = CollectionsView._tree.view.selection.getRangeCount();
      for (let i = 0; i < numRanges && !refreshFlag; i++) {
        CollectionsView._tree.view.selection.getRangeAt(i, rangeFirst, rangeLast);
        for (let index = rangeFirst.value; index <= rangeLast.value; index++) {
          uri = CollectionsView._tree.view.nodeForTreeIndex(index).uri;
          query = new SnowlQuery(uri);
          if ((query.queryGroupIDColumn == "sources.id" &&
               query.queryID == aMessageObj.sourceID) ||
              (query.queryGroupIDColumn == "author.id" &&
               query.queryID == aMessageObj.authorID))
            refreshFlag = true;
        }
      }

      if (refreshFlag) {
        gMessageViewWindow.SnowlMessageView._collection.invalidate();
        gMessageViewWindow.SnowlMessageView._rebuildView();
      }
    }, 30)

  },

  onMessagesComplete: function(aSourceId) {
    // Finished downloading all messages.  Scroll the collection tree intelligently.
//    SnowlUtils.scrollPlacement(this._tree, this._tree.currentIndex);
  },

  onSelect: function(aEvent) {
    // We want to only select onClick (more precisely, mouseup) for mouse events
    // but need onSelect for key events (arrow keys).  Since onSelect events do
    // not have info on whether mouse or key, we track it ourselves.
    if (this._tree.currentIndex == -1 || SnowlUtils.gMouseEvent)
      return;

    this.onClick(aEvent);
  },

  onClick: function(aEvent) {
    let row = { }, col = { }, obj = { };
    let constraints = [];
    let itemId, uri, rangeFirst = { }, rangeLast = { }, stop = false;
    let modKey = aEvent.metaKey || aEvent.ctrlKey || aEvent.shiftKey;

this._log.info("onClick start: curIndex:curSelectedIndex = "+
  this._tree.currentIndex+" : "+this._tree.currentSelectedIndex);
this._log.info("onClick start: selNodeViewIndex:viewSelcurIndex = "+
  (this._tree.selectedNode ?
  this._tree.selectedNode.viewIndex+" : "+this._tree.view.selection.currentIndex :
  "NULL selectedNode"));
this._log.info("onClick start - gMouseEvent:gRtbutton:modKey = "+
  SnowlUtils.gMouseEvent+" : "+SnowlUtils.gRightMouseButtonDown+" : "+modKey);
this._log.info("onClick: selectionCount = "+this._tree.view.selection.count);

    // Don't run query on right click, or already selected row (unless deselecting).
    if (SnowlUtils.gRightMouseButtonDown || this._tree.currentIndex == -1 ||
        (this._tree.view.selection.count == 1 && !modKey &&
         this._tree.currentIndex == this._tree.currentSelectedIndex))
      return;

    // If mod key deselected, reset currentIndex
    if (modKey && !this._tree.view.selection.isSelected(this._tree.currentIndex))
      this._tree.currentIndex = -1;

    // On unsubscribe, RestoreSelection() attempts to select the last selected
    // row, which may have been removed as a result of source unsubscribe, in
    // which case there should be a null selectedNode.  Shift-left click will
    // also deselect a row.  Notify list view to clear the message list.
    let numRanges = this._tree.view.selection.getRangeCount();
    if (this._tree.view.selection.count == 0) {
      gMessageViewWindow.SnowlMessageView._collection.clear();
      gMessageViewWindow.SnowlMessageView._rebuildView();
      this._tree.currentSelectedIndex = -1;
      return;
    }

    // XXX: file behavior bug - closing container with selected child selects
    // container, does not remember selected child on open.  Restoring original
    // selection by traversing the tree for itemID is too expensive here.
    this._tree.boxObject.getCellAt(aEvent.clientX, aEvent.clientY, row, col, obj);
    if (obj.value == "twisty") {
//      SnowlUtils.RestoreSelection(CollectionsView._tree);
      return;
    }

    // Reset stored selection array.
    SnowlUtils.gListViewCollectionItemIds = [];
    // Get selected row(s) and construct a query.
    for (let i = 0; i < numRanges && !stop; i++) {
      this._tree.view.selection.getRangeAt(i, rangeFirst, rangeLast);
      for (let index = rangeFirst.value; index <= rangeLast.value; index++) {
        itemId = this._tree.view.nodeForTreeIndex(index).itemId;
        SnowlUtils.gListViewCollectionItemIds.push(itemId);
        uri = this._tree.view.nodeForTreeIndex(index).uri;
        let query = new SnowlQuery(uri);
        if (query.queryProtocol == "place:") {
          // Currently, any place: protocol is a collection that returns all
          // records; for any such selection, break with no constraints.  There
          // may be other such 'system' collections but more likely collections
          // will be rows which are user defined snowl: queries.  Folders TBD.
          constraints = null;
          stop = true;
          break;
        }
        else {
          // Construct the contraint to be passed to the collection object for
          // the db query.
          let constraint = { };
          constraint.expression = query.queryGroupIDColumn +
                                  " = :groupValue" + index;
          constraint.parameters = { };
          constraint.parameters["groupValue" + index] = query.queryID;
          constraint.operator = "OR";
          constraints.push(constraint);
this._log.info("onClick: constraints = " + constraints.toSource());
        }
      }
    }

    let collection = new SnowlCollection(null, name, null, constraints, null);
    gMessageViewWindow.SnowlMessageView.setCollection(collection);

    this._tree.currentSelectedIndex = this._tree.currentIndex;
    SnowlUtils.gMouseEvent = null;
  },

  onCollectionsTreeMouseDown: function(aEvent) {
    SnowlUtils.onTreeMouseDown(aEvent, this._tree);
  },

  onTreeContextPopupHidden: function() {
    SnowlUtils.RestoreSelection(this._tree, SnowlUtils.gListViewCollectionItemIds);
  },

  onSubscribe: function() {
    SnowlService.gBrowserWindow.Snowl.onSubscribe();
  },

  onUnsubscribe: function() {
    this.unsubscribe();
  },

  onRefresh: function() {
    SnowlService.refreshAllSources();
  },

  refreshSource: function() {
    let selectedSources = [];

    // XXX: Multiselection?
    let selectedSource =
        this._tree.view.nodeForTreeIndex(this._tree.currentSelectedIndex);
    // Create places query object from tree item uri
    let query = new SnowlQuery(selectedSource.uri);
    if (query.queryGroupIDColumn != "sources.id")
      return;

    selectedSources.push(SnowlService.sourcesByID[query.queryID]);
    SnowlService.refreshAllSources(selectedSources);
  },

  unsubscribe: function() {
    let selectedSourceNodeID = [];
    let selectedSourceNodesIDs = [];
    let unsubCurSel = false;

    // XXX: Multiselection? since only a source type may be unsubscribed and
    // the tree contains mixed types of items, this needs some thought. Single
    // selection only for now.
    // XXX: fix contextmenu

    let selectedSource =
        this._tree.view.nodeForTreeIndex(this._tree.currentSelectedIndex);
    // No selection or unsubscribing current selection?
    if (selectedSource.viewIndex == this._tree.currentIndex)
      unsubCurSel = true;
    // Create places query object from tree item uri
    let query = new SnowlQuery(selectedSource.uri);

    if (query.queryGroupIDColumn != "sources.id")
      return;
this._log.info("unsubscribe: source - " + query.queryName + " : " + selectedSource.itemId);

    selectedSourceNodeID = [selectedSource, query.queryID];
    selectedSourceNodesIDs.push(selectedSourceNodeID);

    // Delete loop here, if multiple selections..
    for (let i = 0; i < selectedSourceNodesIDs.length; ++i) {
      sourceNode = selectedSourceNodesIDs[i][0];
      sourceID = selectedSourceNodesIDs[i][1];
      SnowlDatastore.dbConnection.beginTransaction();
      try {
        // Delete messages
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM metadata " +
            "WHERE messageID IN " +
            "(SELECT id FROM messages WHERE sourceID = " + sourceID + ")");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM partsText " +
            "WHERE docid IN " +
            "(SELECT id FROM parts WHERE messageID IN " +
            "(SELECT id FROM messages WHERE sourceID = " + sourceID + "))");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM parts " +
            "WHERE messageID IN " +
            "(SELECT id FROM messages WHERE sourceID = " + sourceID + ")");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM messages " +
            "WHERE sourceID = " + sourceID);
        // Delete people/identities
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM people " +
            "WHERE id IN " +
            "(SELECT personId FROM identities WHERE sourceID = " + sourceID + ")");
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM identities " +
            "WHERE sourceID = " + sourceID);
        // Delete the source
        SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM sources " +
            "WHERE id = " + sourceID);
        // Finally, clean up the places tree
        // Authors XXX: a more efficient way would be much better here..
        let anno = SnowlPlaces.SNOWL_COLLECTIONS_GROUPEDFOLDER_ANNO + "Authors";
        let pages = PlacesUtils.annotations.getPagesWithAnnotation(anno, { });
        for (let i = 0; i < pages.length; ++i) {
          let annoVal = PlacesUtils.annotations.getPageAnnotation(pages[i], anno);
          if (annoVal == "snowl:sourceID=" + sourceID) {
            let bookmarkIds = PlacesUtils.bookmarks.getBookmarkIdsForURI(pages[i], {});
            for (let j=0; j < bookmarkIds.length; j++) {
              PlacesUtils.bookmarks.removeItem(bookmarkIds[j]);
            }
          }
        }
        // Source
        PlacesUtils.bookmarks.removeItem(sourceNode.itemId);

        SnowlDatastore.dbConnection.commitTransaction();
      }
      catch(ex) {
        SnowlDatastore.dbConnection.rollbackTransaction();
        throw ex;
      }
    }

    if (unsubCurSel) {
      this._tree.currentSelectedIndex = -1;
    }

    SnowlUtils.gListViewDeleteMoveInsert = true;
    Observers.notify("snowl:source:removed");
  },


  //**************************************************************************//
  // Places conversion

  // Create the source/authors collection from the db to convert to places.
  _collections: null,
  _getCollections: function() {
    this._collections = [];

    let statement = SnowlDatastore.createStatement(
      "SELECT id, name, iconURL, grouped, groupIDColumn, groupNameColumn, " +
        "groupHomeURLColumn, groupIconURLColumn " +
      "FROM collections ORDER BY orderKey"
    );

    statement.QueryInterface(Ci.mozIStorageStatementWrapper);

    try {
      while (statement.step()) {
        this._collections.push(new SnowlCollection(statement.row.id,
                                                   statement.row.name,
                                                   URI.get(statement.row.iconURL),
                                                   null,
                                                   null,
                                                   statement.row.grouped ? true : false,
                                                   statement.row.groupIDColumn,
                                                   statement.row.groupNameColumn,
                                                   statement.row.groupHomeURLColumn,
                                                   statement.row.groupIconURLColumn));
      }
    }
    finally {
      statement.reset();
    }
  },

  // Convert the list of rows in the tree to places.
  _buildCollectionTree: function() {
    for each (let collection in this._collections) {
      if (collection.grouped) {
        let table, value, sourceID, personID;
        switch (collection.groupIDColumn) {
          case "sources.id":
            table = "sources";
            break;
          case "authors.id":
            table = "people";
            break;
          default:
            table = null;
            break;
        }
        for each (let group in collection.groups) {
//this._log.info(table+" group.name:group.groupID - " + group.name + " : " + group.groupID);
          if (table == "sources")
            value = group.groupID;
          else if (table == "people") {
            if (!group.groupID)
              // Skip null authors
              continue;
            // Get the sourceID that the author belongs to
            value = SnowlDatastore.selectIdentitiesSourceID(group.groupID);
          }
          placeID = SnowlPlaces.persistPlace(table,
                                             group.groupID,
                                             group.name,
                                             null, //machineURI.spec,
                                             null, //username,
                                             group.iconURL,
                                             value); // aSourceID
          // Store placeID back into messages for db integrity
          SnowlDatastore.dbConnection.executeSimpleSQL(
            "UPDATE " + table +
            " SET    placeID = " + placeID +
            " WHERE       id = " + group.groupID);

this._log.info("Converted to places - " +
group.name + " : " + group.groupID + " : " + placeID);
        }
      }
    }
  }

};

/**
 * A single collection list view tree row.
 * 
 * @aNode (nsINavHistoryResultNode) collection row node

function lvCollectionNode(aNode) {
  this._node = aNode;
}
lvCollectionNode.prototype = {
  get uri() {
    delete this._uri;
    return this._uri = this._node ? _node.uri : null;
  },

  get itemId() {
    delete this._itemId;
    return this._itemId = this._node ? _node.itemId : null;
  },

  get viewIndex() {
    delete this.viewIndex;
    return this.viewIndex = this._node ? _node.viewIndex : -1;
  }
};
 */
/**
 * PlacesTreeView overrides here.
 *
 */
PlacesTreeView.prototype._drop = PlacesTreeView.prototype.drop;
PlacesTreeView.prototype.drop = SnowlTreeViewDrop;
function SnowlTreeViewDrop(aRow, aOrientation) {
  this._drop(aRow, aOrientation);

  SnowlUtils.gListViewDeleteMoveInsert = true;
  SnowlUtils.RestoreSelection(CollectionsView._tree,
                              SnowlUtils.gListViewCollectionItemIds);
};

// Not using this yet..
//function PlacesController(aView) {
//  this._view = aView;
//}

//PlacesController.prototype = {
  /**
   * The places view.
   */
//  _view: null
//};

window.addEventListener("load", function() { CollectionsView.init() }, true);
