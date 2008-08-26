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
Cu.import("resource://snowl/modules/collection.js");

// FIXME: import these into an object to avoid name collisions.
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/Preferences.js");

let Snowl = {
  get _prefs() {
    delete this._prefs;
    return this._prefs = new Preferences("extensions.snowl.");
  },

  get _version() {
    let em = Cc["@mozilla.org/extensions/manager;1"].
             getService(Ci.nsIExtensionManager);
    let addon = em.getItemForID("snowl@mozilla.org");
    delete this._version;
    return this._version = addon.version;
  },

  init: function() {
    let lastVersion = this._prefs.get("lastVersion");

    if (!lastVersion) {
      let url = "chrome://snowl/content/firstrun.html";
      setTimeout(function() { window.openUILinkIn(url, "tab") }, 500);
    }
    else if (lastVersion != this._version) {
      // We don't use this code yet because we haven't yet set up update.html
      // to properly list changes yet.
      // FIXME: make this work.
      //let url = "chrome://snowl/content/update.html?old=" + lastVersion +
      //          "&new=" + this._version;
      //setTimeout(function() { window.openUILinkIn(url, "tab"); }, 500);
    }

    this._prefs.set("lastVersion", this._version);
  }
};


let SnowlMessageView = {
  _log: null,

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    delete this._obsSvc;
    this._obsSvc = obsSvc;
    return this._obsSvc;
  },

  // Date Formatting Service
  get _dfSvc() {
    let dfSvc = Cc["@mozilla.org/intl/scriptabledateformat;1"].
                getService(Ci.nsIScriptableDateFormat);
    delete this._dfSvc;
    this._dfSvc = dfSvc;
    return this._dfSvc;
  },

  // Atom Service
  get _atomSvc() {
    let atomSvc = Cc["@mozilla.org/atom-service;1"].
                  getService(Ci.nsIAtomService);
    delete this._atomSvc;
    this._atomSvc = atomSvc;
    return this._atomSvc;
  },

  // The ID of the source to display.  The sidebar can set this to the source
  // selected by the user.
  // FIXME: make this an array of sources, and let the user select multiple
  // sources to view multiple sources simultaneously.
  sourceID: null,

  get _filter() {
    delete this._filter;
    return this._filter = document.getElementById("snowlFilter");
  },

  get _tree() {
    delete this._tree;
    return this._tree = document.getElementById("snowlView");
  },

  get _currentButton() {
    delete this._currentButton;
    return this._currentButton = document.getElementById("snowlCurrentButton");
  },

  get _unreadButton() {
    delete this._unreadButton;
    return this._unreadButton = document.getElementById("snowlUnreadButton");
  },

  // Maps XUL tree column IDs to collection properties.
  _columnProperties: {
    "snowlAuthorCol": "author",
    "snowlSubjectCol": "subject",
    "snowlTimestampCol": "timestamp"
  },


  //**************************************************************************//
  // nsITreeView

  get rowCount() {
this._log.info("get rowCount: " + this._collection.messages.length);
    return this._collection.messages.length;
  },

  getCellText: function(aRow, aColumn) {
    // FIXME: use _columnProperties instead of hardcoding column
    // IDs and property names here.
    switch(aColumn.id) {
      case "snowlAuthorCol":
        return this._collection.messages[aRow].author;
      case "snowlSubjectCol":
        return this._collection.messages[aRow].subject;
      case "snowlTimestampCol":
        return this._formatTimestamp(new Date(this._collection.messages[aRow].timestamp));
      default:
        return null;
    }
  },

  _treebox: null,
  setTree: function(treebox){ this._treebox = treebox; },
  cycleHeader: function(aColumn) {},

  isContainer: function(aRow) { return false },
  isSeparator: function(aRow) { return false },
  isSorted: function() { return false },
  getLevel: function(aRow) { return 0 },
  getImageSrc: function(aRow, aColumn) { return null },
  getRowProperties: function (aRow, aProperties) {},

  getCellProperties: function (aRow, aColumn, aProperties) {
    // We have to set this on each cell rather than on the row as a whole
    // because the styling we apply to unread messages (bold text) has to be
    // specified by the ::-moz-tree-cell-text pseudo-element, which inherits
    // only the cell's properties.
    if (!this._collection.messages[aRow].read)
      aProperties.AppendElement(this._atomSvc.getAtom("unread"));
  },

  getColumnProperties: function(aColumnID, aColumn, aProperties) {},

  // We could implement inline tagging with an editable "Tags" column
  // by making this true, adding editable="true" to the tree tag, and
  // then marking only the tags column as editable.
  isEditable: function() { return false },


  //**************************************************************************//
  // Initialization and Destruction

  init: function() {
    this._log = Log4Moz.Service.getLogger("Snowl.View");
    this._obsSvc.addObserver(this, "messages:changed", true);

    let container = document.getElementById("snowlViewContainer");
    if (container.getAttribute("placement") == "side")
      this.placeOnSide();

    this._collection = new SnowlCollection();
    this._sort();
    this._tree.view = this;
  },

  destroy: function() {
    this._obsSvc.removeObserver(this, "messages:changed");
  },


  //**************************************************************************//
  // Misc XPCOM Interfaces

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
      case "messages:changed":
        this._onMessagesChanged();
        break;
    }
  },


  //**************************************************************************//
  // Event & Notification Handling

  _onMessagesChanged: function() {
    // FIXME: make the collection listen for message changes and invalidate
    // itself, then rebuild the view in a timeout to give the collection time
    // to do so.
    this._collection.invalidate();
    this._rebuildView();
  },

  onFilter: function() {
    this._applyFilters();
  },

  onCommandCurrentButton: function(aEvent) {
    this._applyFilters();
  },

  onCommandUnreadButton: function(aEvent) {
    // XXX Instead of rebuilding from scratch each time, when going from
    // all to unread, simply hide the ones that are read (f.e. by setting a CSS
    // class on read items and then using a CSS rule to hide them)?
    this._applyFilters();
  },

  _applyFilters: function() {
    let filters = [];

    if (this._currentButton.checked)
      filters.push({ expression: "current = 1", parameters: {} });

    if (this._unreadButton.checked)
      filters.push({ expression: "read = 0", parameters: {} });

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    if (this._filter.value)
      filters.push({ expression: "messages.id IN (SELECT messageID FROM parts WHERE content MATCH :filter)",
                     parameters: { filter: this._filter.value } });

    this._collection.filters = filters;
    this._collection.invalidate();
    this._rebuildView();
  },

  setCollection: function(collection) {
    this._collection = collection;
    this._rebuildView();
  },

  _rebuildView: function() {
    // Clear the selection before we rebuild the view, since it won't apply
    // to the new data.
    this._tree.view.selection.clearSelection();

    // Since the number of rows might have changed, we rebuild the view
    // by reinitializing it instead of merely invalidating the box object
    // (which wouldn't accommodate changes to the number of rows).
    // XXX Is there a better way to do this?
    this._tree.view = this;

    // Scroll back to the top of the tree.
    this._tree.boxObject.scrollToRow(this._tree.boxObject.getFirstVisibleRow());
  },

  // From toolkit/mozapps/update/content/history.js
  // XXX Really? ^

  /**
   * Formats a timestamp for human consumption using the date formatting service
   * for locale-specific formatting along with some additional smarts for more
   * human-readable representations of recent timestamps.
   * @param   {Date} the timestamp to format
   * @returns a human-readable string
   */
  _formatTimestamp: function(aTimestamp) {
    let formattedString;

    let now = new Date();

    let yesterday = new Date(now - 24 * 60 * 60 * 1000);
    yesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

    let sixDaysAgo = new Date(now - 6 * 24 * 60 * 60 * 1000);
    sixDaysAgo = new Date(sixDaysAgo.getFullYear(), sixDaysAgo.getMonth(), sixDaysAgo.getDate());

    if (aTimestamp.toLocaleDateString() == now.toLocaleDateString())
      formattedString = this._dfSvc.FormatTime("",
                                               this._dfSvc.timeFormatNoSeconds,
                                               aTimestamp.getHours(),
                                               aTimestamp.getMinutes(),
                                               null);
    else if (aTimestamp > yesterday)
      formattedString = "Yesterday " + this._dfSvc.FormatTime("",
                                                              this._dfSvc.timeFormatNoSeconds,
                                                              aTimestamp.getHours(),
                                                              aTimestamp.getMinutes(),
                                                              null);
    else if (aTimestamp > sixDaysAgo)
      formattedString = this._dfSvc.FormatDateTime("",
                                                   this._dfSvc.dateFormatWeekday, 
                                                   this._dfSvc.timeFormatNoSeconds,
                                                   aTimestamp.getFullYear(),
                                                   aTimestamp.getMonth() + 1,
                                                   aTimestamp.getDate(),
                                                   aTimestamp.getHours(),
                                                   aTimestamp.getMinutes(),
                                                   aTimestamp.getSeconds());
    else
      formattedString = this._dfSvc.FormatDateTime("",
                                                   this._dfSvc.dateFormatShort, 
                                                   this._dfSvc.timeFormatNoSeconds,
                                                   aTimestamp.getFullYear(),
                                                   aTimestamp.getMonth() + 1,
                                                   aTimestamp.getDate(),
                                                   aTimestamp.getHours(),
                                                   aTimestamp.getMinutes(),
                                                   aTimestamp.getSeconds());

    return formattedString;
  },

  switchPlacement: function() {
    let container = document.getElementById("snowlViewContainer");
    let appcontent = document.getElementById("appcontent");

    if (container.parentNode == appcontent)
      this.placeOnSide();
    else
      this.placeOnTop();
  },

  placeOnSide: function() {
    let browser = document.getElementById("browser");
    let container = document.getElementById("snowlViewContainer");
    let appcontent = document.getElementById("appcontent");
    let splitter = document.getElementById("snowlViewSplitter");

    browser.insertBefore(container, appcontent);
    browser.insertBefore(splitter, appcontent);
    splitter.setAttribute("orient", "horizontal");
    container.setAttribute("placement", "side");

    // Because we've moved the tree, we have to reattach the view to it,
    // or we will get the error: "this._tree.boxObject.invalidate is not
    // a function" when we switch sources.
    this._tree.view = this;
  },

  placeOnTop: function() {
    let appcontent = document.getElementById("appcontent");
    let container = document.getElementById("snowlViewContainer");
    let content = document.getElementById("content");
    let splitter = document.getElementById("snowlViewSplitter");

    appcontent.insertBefore(container, content);
    appcontent.insertBefore(splitter, content);
    splitter.setAttribute("orient", "vertical");
    container.setAttribute("placement", "top");

    // Because we've moved the tree, we have to reattach the view to it,
    // or we will get the error: "this._tree.boxObject.invalidate is not
    // a function" when we switch sources.
    this._tree.view = this;
  },

  onSelect: function(aEvent) {
    if (this._tree.currentIndex == -1)
      return;

    // When we support opening multiple links in the background,
    // perhaps use this code:
    // http://lxr.mozilla.org/mozilla/source/browser/base/content/browser.js#1482

    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];

    //window.loadURI(message.link, null, null, false);
    let url = "chrome://snowl/content/message/message.xul?id=" + message.id;
    window.loadURI(url, null, null, false);

    this._setRead(true);
  },

  onKeyPress: function(aEvent) {
    if (aEvent.altKey || aEvent.metaKey || aEvent.ctrlKey)
      return;

    // which is either the charCode or the keyCode, depending on which is set.
    this._log.info("onKeyPress: which = " + aEvent.which);

    if (aEvent.charCode == "r".charCodeAt(0))
      this._toggleRead(false);
    if (aEvent.charCode == "R".charCodeAt(0))
      this._toggleRead(true);
    else if (aEvent.charCode == " ".charCodeAt(0))
      this._onSpacePress(aEvent);
  },

  // Based on SpaceHit in mailWindowOverlay.js
  _onSpacePress: function(aEvent) {
    if (aEvent.shiftKey) {
      // if at the start of the message, go to the previous one
      if (gBrowser.contentWindow.scrollY > 0)
        gBrowser.contentWindow.scrollByPages(-1);
      else
        this._goToPreviousUnreadMessage();
    }
    else {
      // if at the end of the message, go to the next one
      if (gBrowser.contentWindow.scrollY < gBrowser.contentWindow.scrollMaxY)
        gBrowser.contentWindow.scrollByPages(1);
      else
        this._goToNextUnreadMessage();
    }
  },

  _goToPreviousUnreadMessage: function() {
    let currentIndex = this._tree.currentIndex;
    let i = currentIndex - 1;

    while (i != currentIndex) {
      if (i < 0) {
        i = this._collection.messages.length - 1;
        continue;
      }

      if (!this._collection.messages[i].read) {
        this.selection.select(i);
        this._tree.treeBoxObject.ensureRowIsVisible(i);
        break;
      }

      i--;
    }
  },

  _goToNextUnreadMessage: function() {
    let currentIndex = this._tree.currentIndex;
    let i = currentIndex + 1;

    while (i != currentIndex) {
      if (i > this._collection.messages.length - 1) {
        i = 0;
        continue;
      }
this._log.info(i);
      if (!this._collection.messages[i].read) {
        this.selection.select(i);
        this._tree.treeBoxObject.ensureRowIsVisible(i);
        break;
      }

      i++;
    }
  },

  _toggleRead: function(aAll) {
this._log.info("_toggleRead: all? " + aAll);
    if (this._tree.currentIndex == -1)
      return;

    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];
    if (aAll)
      this._setAllRead(!message.read);
    else
      this._setRead(!message.read);
  },

  _setRead: function(aRead) {
    let row = this._tree.currentIndex;
    let message = this._collection.messages[row];
    message.read = aRead;
    this._tree.boxObject.invalidateRow(row);
  },

  _setAllRead: function(aRead) {
    let ids = this._collection.messages.map(function(v) { return v.id });
    this._collection.messages.forEach(function(v) { v.read = aRead });
    this._tree.boxObject.invalidate();
  },

  show: function() {
    let container = document.getElementById("snowlViewContainer");
    let splitter = document.getElementById("snowlViewSplitter");
    container.hidden = false;
    splitter.hidden = false;
  },

  hide: function() {
    let container = document.getElementById("snowlViewContainer");
    let splitter = document.getElementById("snowlViewSplitter");
    container.hidden = true;
    splitter.hidden = true;
  },

  onClickColumnHeader: function(aEvent) {
    let column = aEvent.target;
    let property = this._columnProperties[column.id];
    let sortResource = this._tree.getAttribute("sortResource");
    let sortDirection = this._tree.getAttribute("sortDirection");

    // FIXME: don't sort if the user right- or middle-clicked the header.

    // Determine the sort order.  If the user clicked on the header for
    // the current sort column, we sort in the reverse of the current order.
    // Otherwise we sort in ascending order.
    let oldOrder = (sortDirection == "ascending" ? 1 : -1);
    let newOrder = (column.id == sortResource ? -oldOrder : 1);

    // Persist the new sort resource and direction.
    let direction = (newOrder == 1 ? "ascending" : "descending");
    this._tree.setAttribute("sortResource", column.id);
    this._tree.setAttribute("sortDirection", direction);

    // Update the sort indicator to appear on the current column.
    let columns = this._tree.getElementsByTagName("treecol");
    for (let i = 0; i < columns.length; i++)
      columns[i].removeAttribute("sortDirection");
    column.setAttribute("sortDirection", direction);

    // Perform the sort.
    this._sort();
  },

  _sort: function() {
    let resource = this._tree.getAttribute("sortResource");
    let property = this._columnProperties[resource];

    let direction = this._tree.getAttribute("sortDirection");
    let order = (direction == "ascending" ? 1 : -1);

    // Perform the sort.
    this._collection.sortProperties = [property];
    this._collection.sortOrder = order;
    this._collection.sort();
  }
};

window.addEventListener("load", function() { Snowl.init() }, false);
window.addEventListener("load", function() { SnowlMessageView.init() }, false);
