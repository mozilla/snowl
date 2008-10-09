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

Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/opml.js");

// FIXME: make this configurable.
const SNOWL_COLLECTIONS_HIERARCHICAL = false;

let SourcesView = {
  _log: null,

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    delete this._obsSvc;
    this._obsSvc = obsSvc;
    return this._obsSvc;
  },

  get _tree() {
    delete this._tree;
    return this._tree = document.getElementById("sourcesView");
  },

  get _children() {
    delete this._children;
    return this._children = this._tree.getElementsByTagName("treechildren")[0];
  },


  //**************************************************************************//
  // Initialization & Destruction

  init: function() {
    this._log = Log4Moz.Service.getLogger("Snowl.Sidebar");
    this._obsSvc.addObserver(this, "sources:changed", true);
    this._getCollections();
    this._tree.view = this;

    // Add a capturing click listener to the tree so we can find out if the user
    // clicked on a row that is already selected (in which case we let them edit
    // the collection name).
    // FIXME: disable this for names that can't be changed.
    this._tree.addEventListener("mousedown", function(aEvent) { SourcesView.onClick(aEvent) }, true);
  },


  //**************************************************************************//
  // nsITreeView

  selection: null,

  get rowCount() {
    return this._rows.length;
  },

  // FIXME: consolidate these two references.
  _treebox: null,
  setTree: function(treeBox) {
    this._treeBox = treeBox;
  },

  getCellText : function(row, column) {
    return this._rows[row].name;
  },

  isContainer: function(row) {
    //this._log.info("isContainer: " + (this._rows[row].groups ? true : false));
    return (this._rows[row].groups ? true : false);
  },
  isContainerOpen: function(row) {
    //this._log.info("isContainerOpen: " + this._rows[row].isOpen);
    return this._rows[row].isOpen;
  },
  isContainerEmpty: function(row) {
    //this._log.info("isContainerEmpty: " + row + " " + this._rows[row].groups.length + " " + (this._rows[row].groups.length == 0));
    return (this._rows[row].groups.length == 0);
  },

  isSeparator: function(row)         { return false },
  isSorted: function()               { return false },

  // FIXME: make this return true for collection names that are editable,
  // and then implement name editing on the new architecture.
  isEditable: function(row, column)  { return false },

  getParentIndex: function(row) {
    //this._log.info("getParentIndex: " + row);

    let thisLevel = this.getLevel(row);

    if (thisLevel == 0)
      return -1;
    for (let t = row - 1; t >= 0; t--)
      if (this.getLevel(t) < thisLevel)
        return t;

    throw "getParentIndex: couldn't figure out parent index for row " + row;
  },

  getLevel: function(row) {
    //this._log.info("getLevel: " + row);

    if (!SNOWL_COLLECTIONS_HIERARCHICAL)
      return 0;

    return this._rows[row].level;
  },

  hasNextSibling: function(idx, after) {
    //this._log.info("hasNextSibling: " + idx + " " + after);

    let thisLevel = this.getLevel(idx);
    for (let t = idx + 1; t < this._rows.length; t++) {
      let nextLevel = this.getLevel(t);
      if (nextLevel == thisLevel)
        return true;
      if (nextLevel < thisLevel)
        return false;
    }

    return false;
  },

  getImageSrc: function(row, column) {
    if (column.id == "nameCol") {
      let iconURL = this._rows[row].iconURL;
      if (iconURL)
        return iconURL.spec;
    }

    return null;
  },

  toggleOpenState: function(idx) {
    //this._log.info("toggleOpenState: " + idx);

    let item = this._rows[idx];
    if (!item.groups)
      return;

    if (item.isOpen) {
      item.isOpen = false;

      let thisLevel = this.getLevel(idx);
      let numToDelete = 0;
      for (let t = idx + 1; t < this._rows.length; t++) {
        if (this.getLevel(t) > thisLevel)
          numToDelete++;
        else
          break;
      }
      if (numToDelete) {
        this._rows.splice(idx + 1, numToDelete);
        this._treeBox.rowCountChanged(idx + 1, -numToDelete);
      }
    }
    else {
      item.isOpen = true;

      let groups = this._rows[idx].groups;
      for (let i = 0; i < groups.length; i++)
        this._rows.splice(idx + 1 + i, 0, groups[i]);
      this._treeBox.rowCountChanged(idx + 1, groups.length);
    }
  },

  getRowProperties: function (row, properties) {},
  getCellProperties: function (row, column, properties) {},
  getColumnProperties: function(columnID, column, properties) {},

  setCellText: function(aRow, aCol, aValue) {
    let statement = SnowlDatastore.createStatement("UPDATE sources SET name = :name WHERE id = :id");
    statement.params.name = this._rows[aRow].name = aValue;
    statement.params.id = this._rows[aRow].id;

    try {
      statement.execute();
    }
    finally {
      statement.reset();
    }
  },


  //**************************************************************************//
  // Misc XPCOM Interface Implementations

  // nsISupports
  QueryInterface: function(aIID) {
    if (aIID.equals(Ci.nsIObserver) ||
        aIID.equals(Ci.nsISupportsWeakReference) ||
        aIID.equals(Ci.nsISupports))
      return this;

    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  // nsIObserver
  observe: function(subject, topic, data) {
    switch (topic) {
      case "sources:changed":
        this._getCollections();
        // Rebuild the view to reflect the new collection of messages.
        // Since the number of rows might have changed, we do this by reinitializing
        // the view instead of merely invalidating the box object (which doesn't
        // expect changes to the number of rows).
        this._tree.view = this;
        break;
    }
  },

  _collections: null,
  _getCollections: function() {
    this._collections = [];

    let statement = SnowlDatastore.createStatement(
      "SELECT id, name, iconURL, grouped, groupIDColumn, groupNameColumn, " +
      "groupHomeURLColumn, groupIconURLColumn FROM collections ORDER BY orderKey"
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

    // Build the list of rows in the tree.  By default, all containers
    // are closed, so this is the same as the list of collections, although
    // in the future we might persist and restore the open state.
    // XXX Should this work be in a separate function?
    if (SNOWL_COLLECTIONS_HIERARCHICAL) {
      this._rows = [collection for each (collection in this._collections)];
    }
    else {
      this._rows = [];
      for each (let collection in this._collections) {
        if (collection.grouped)
          for each (let group in collection.groups)
            this._rows.push(group);
        else
          this._rows.push(collection);
      }
    }
  },

  onSelect: function(aEvent) {
    if (this._tree.currentIndex == -1)
      return;

    let collection = this._rows[this._tree.currentIndex];
    gMessageViewWindow.SnowlMessageView.setCollection(collection);
  },

  onClick: function(aEvent) {
this._log.info("on click");
//this._log.info(Log4Moz.enumerateProperties(aEvent).join("\n"));
//this._log.info(aEvent.target.nodeName);

  let row = {}, col = {}, child = {};
  this._tree.treeBoxObject.getCellAt(aEvent.clientX, aEvent.clientY, row, col, child);
  if (this._tree.view.selection.isSelected(row.value))
this._log.info(row.value + " is selected");
else
this._log.info(row.value + " is not selected");
  },

  unsubscribe: function() {
    let collection = this._rows[this._tree.currentIndex];

    if (!collection.parent || collection.parent.groupIDColumn != "sources.id")
      return;

    let sourceID = this._rows[this._tree.currentIndex].groupID;

    SnowlDatastore.dbConnection.beginTransaction();
    try {
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM metadata WHERE messageID IN (SELECT id FROM messages WHERE sourceID = " + sourceID + ")");
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM parts WHERE messageID IN (SELECT id FROM messages WHERE sourceID = " + sourceID + ")");
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM messages WHERE sourceID = " + sourceID);
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM sources WHERE id = " + sourceID);
      SnowlDatastore.dbConnection.commitTransaction();
    }
    catch(ex) {
      SnowlDatastore.dbConnection.rollbackTransaction();
      throw ex;
    }

    this._obsSvc.notifyObservers(null, "sources:changed", null);
    this._obsSvc.notifyObservers(null, "messages:changed", null);
  }

};

window.addEventListener("load", function() { SourcesView.init() }, true);
