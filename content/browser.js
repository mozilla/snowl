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
 *   alta88 <alta88@gmail.com>
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

// We have to import these here, even though we don't use them in this overlay,
// so that they get parsed and register themselves with the service.
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/twitter.js");

Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/opml.js");

let Snowl = {
  // The Preferences service that is imported from the Preferences module below.
  // XXX Could we import it lazily when this property is first accessed?
  Preferences: null,

  get _prefs() {
    delete this._prefs;
    return this._prefs = new this.Preferences("extensions.snowl.");
  },

  get _version() {
    let em = Cc["@mozilla.org/extensions/manager;1"].
             getService(Ci.nsIExtensionManager);
    let addon = em.getItemForID("snowl@mozilla.org");
    delete this._version;
    return this._version = addon.version;
  },

  get _mainWindow() {
    delete this._mainWindow;
    return this._mainWindow = document.getElementById("main-window");
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

    // Init tab listeners
    this._initTabListeners();

    // Init river tab 
    setTimeout(function() { Snowl._initSnowlRiverTab() }, 100);

  },


  //**************************************************************************//
  // Menu Popups

  onToolsMenuPopupShowing: function(event) {
    // Reuse popup
    let popup = document.getElementById("snowlMenuPopup");
    let element = document.getElementById("snowlMenu");
    document.popupNode = element;
    popup.hidden = false;
    popup.openPopup(element, "end_before", -3);
  },

  onToolsMenuPopupHiding: function(event) {
    // Hide it manually, no idea why .hidePopup doesn't work..
    let popup = document.getElementById("snowlMenuPopup");
    //popup.hidePopup();
    popup.hidden = true;
  },

  onSnowlMenuPopupShowing: function(event) {
    // River view menuitem checkstate is off if its tab is not selected+focused
    let rivermenuitem = document.getElementById("viewSnowlRiver");
    let isRiverTab = gBrowser.selectedTab.hasAttribute("snowl");
    rivermenuitem.setAttribute("checked", isRiverTab);

    if (event.target.id == "snowlMenuPopup")
      if (document.popupNode.localName == "toolbarbutton")
        document.popupNode.setAttribute("open", true);
  },

  onSnowlMenuPopupHiding: function(event) {
    event.target.hidden = false;
    if (event.target.id == "snowlMenuPopup")
      if (document.popupNode.localName == "toolbarbutton")
        document.popupNode.removeAttribute("open");
  },

  layoutName: ["classic", "vertical", "widemessage", "widethread", "stacked"],

  onLayoutPopupShowing: function(event) {
    // Layout checked state
    let layoutmenu = document.getElementById("snowlLayoutMenu");
    let lchecked = document.getElementById("viewSnowlList").hasAttribute("checked");
    let schecked = document.getElementById("viewSnowlStream").hasAttribute("checked");
    let layoutmenuitems = document.getElementsByAttribute("name", "snowlLayoutMenuitemGroup");
    let layout = this._mainWindow.getAttribute("snowllayout");
    let layoutIndex = this.layoutName.indexOf(layout);

    if (layoutmenuitems) {
      for (var i = 0; i < layoutmenuitems.length; i++) {
        layoutmenuitems[i].setAttribute("disabled", !lchecked);
        if (i == layoutIndex)
          layoutmenuitems[i].setAttribute("checked", true);
      }
    }

    // Header checked state
    let menuitems = document.getElementsByAttribute("name", "snowlHeaderMenuitemGroup");
    let selectedIndex = this._prefs.get("message.headerView");
    if (menuitems) {
      for (var i = 0; i < menuitems.length; i++) {
        menuitems[i].setAttribute("disabled", !this._listMessageHeader());
        if (i == selectedIndex)
          menuitems[i].setAttribute("checked", true);
      }
    }

    // Hierarchy init 
    let hmenuitems = document.getElementsByAttribute("name", "snowlHierarchyMenuitemGroup");
    let isHierarchical = this._prefs.get("collection.hierarchicalView");
    let rivertab = this._snowlRiverTab();
    if (hmenuitems) {
      for (var i = 0; i < hmenuitems.length; i++) {
        hmenuitems[i].setAttribute("disabled", !lchecked && !(rivertab));
        if (i == isHierarchical)
          hmenuitems[i].setAttribute("checked", true);
      }
    }

    // Toolbars
    document.getElementById("snowlToolbarMenuitem").setAttribute("disabled",
        (!lchecked && !schecked) ? true : false);
    document.getElementById("snowlViewToolbarMenuitem").setAttribute("disabled",
        (!lchecked) ? true : false)
  },

  onSnowlButtonMouseDown: function(event) {
    // Jumping thru hoops to reuse popup for menupopup and button..
    let popup = document.getElementById("snowlMenuPopup");
    popup.hidden = false;
  },

  // Correct state of button based on message in current tab
  // XXX better to add url change listener?
  onSnowlToggleHeaderButtonMouseover: function(event) {
    event.target.setAttribute("disabled", !this._listMessageHeader());
  },


  //**************************************************************************//
  // Event Handlers

  onRiverView: function() {
    // Unchecking river menuitem, if current tab is snowl river tab, close it
    let snowlRiverTab = this._snowlRiverTab();
    if (gBrowser.selectedTab == snowlRiverTab) {
      this.closeRiverView(gBrowser.selectedTab);
      return;
    }

    // Handle unchecked menuitem
    if (snowlRiverTab != null) {
      // Snowl River tab is already open, focus it
      gBrowser.selectedTab = snowlRiverTab;
      gBrowser.focus();
    }
    else {
      // River tab not open, create a new one, toggle other views in sidebar 'off'
//      let lchecked = document.getElementById("viewSnowlList").hasAttribute("checked");
//      let schecked = document.getElementById("viewSnowlStream").hasAttribute("checked");
//      if (lchecked)
//        toggleSidebar('viewSnowlList');
//      if (schecked)
//        toggleSidebar('viewSnowlStream');

      gBrowser.selectedTab = gBrowser.addTab("chrome://snowl/content/river.xul");
      let tabIndex = gBrowser.mTabContainer.selectedIndex;
      this._mainWindow.setAttribute("snowltabindex", tabIndex);
      gBrowser.mTabs[tabIndex].setAttribute("snowl", "river");

      let riverbroadcaster = document.getElementById("viewSnowlRiver");
      let isRiverTab = gBrowser.selectedTab.hasAttribute("snowl");
      if (riverbroadcaster)
        riverbroadcaster.setAttribute("checked", isRiverTab);
    }
  },

  closeRiverView: function(aTab) {
    gBrowser.removeTab(aTab);
    document.getElementById("viewSnowlRiver").setAttribute("checked", false);
  },

  onTabSelect: function() {
    // Make sure desired header view showing..
    this._toggleHeader("TabSelect");

    // Set checkstate of River broadcaster
    let riverbroadcaster = document.getElementById("viewSnowlRiver");
    let isRiverTab = gBrowser.selectedTab.hasAttribute("snowl");
    if (riverbroadcaster)
      riverbroadcaster.setAttribute("checked", isRiverTab);
  },

  onCheckForNewMessages: function() {
    SnowlService.refreshAllSources();
  },

  onSubscribe: function() {
    gBrowser.selectedTab =
      gBrowser.addTab("chrome://snowl/content/subscribe.xul");
  },

  onImportOPML: function() {
    gBrowser.selectedTab =
      gBrowser.addTab("chrome://snowl/content/subscribe.xul?tab=opml");
  },

  onExportOPML: function() {
    SnowlOPML.export(window);
  },

  _initTabListeners: function() {
    // TabSelect - make sure header state correct
    gBrowser.tabContainer.addEventListener("TabSelect",
        function() { Snowl.onTabSelect("TabSelect"); }, false);

    // TabOpen, TabClose, TabMove - make sure snowl River tab index is correct
    gBrowser.tabContainer.addEventListener("TabOpen",
        function() { Snowl._resetSnowlRiverTabIndex(); }, false);
    gBrowser.tabContainer.addEventListener("TabClose",
        function() { Snowl._resetSnowlRiverTabIndex(); }, false);
    gBrowser.tabContainer.addEventListener("TabMove",
        function() { Snowl._resetSnowlRiverTabIndex(); }, false);
  },

  //**************************************************************************//
  // Buttons, menuitems, commands..

  // Header toggle
  kNoHeader: 0,
  kBriefHeader: 1,
  kFullHeader: 2,

  _toggleHeader: function(val) {
    let contentWindowDoc = gBrowser.selectedBrowser.contentDocument;
    let selectedIndex = null;
    let headerDeck = this._listMessageHeader();
    let button = document.getElementById("snowlToggleHeaderButton");
    if (button)
      button.setAttribute("disabled", !headerDeck ? true : false);

    // Not a snowl message in the tab..
    if (!headerDeck)
      return;

    let briefHeader = new XPCNativeWrapper(contentWindowDoc, "getElementById()")
        .getElementById("briefHeader");
    let fullHeader = new XPCNativeWrapper(contentWindowDoc, "getElementById()")
        .getElementById("fullHeader");
    let menuitems = document.getElementsByAttribute("name", "snowlHeaderMenuitemGroup");

    if (val == "TabSelect")
      // Make sure tab switch reflects header state
      selectedIndex = this._prefs.get("message.headerView");
    else if (val == "Toggle") {
      // Toggled to next in 3 way
      selectedIndex = parseInt(headerDeck.selectedIndex);
      selectedIndex = ++selectedIndex > 2 ? 0 : selectedIndex++;
      this._prefs.set("message.headerView", selectedIndex);
    }
    else {
      // Passed an event from menuitem choice
      selectedIndex = eval(val.target.getAttribute("headerType"));
      val.target.setAttribute("checked", true);
      this._prefs.set("message.headerView", selectedIndex);
    }

    headerDeck.setAttribute("selectedIndex", selectedIndex);
    briefHeader.setAttribute("collapsed", selectedIndex == 1 ? false : true);
    fullHeader.setAttribute("collapsed", selectedIndex == 2 ? false : true);

    if (button)
      button.setAttribute("snowlHeader", selectedIndex == 0 ?
          "none" : (selectedIndex == 1 ? "brief" : "full"));
    if (menuitems) {
      menuitems[selectedIndex].setAttribute("checked", true);
    }
  },

  _listMessageHeader: function() {
    let contentWindowDoc = gBrowser.selectedBrowser.contentDocument;
    let headerDeck = new XPCNativeWrapper(contentWindowDoc, "getElementById()")
        .getElementById("headerDeck");
    return headerDeck;
  },

  // Collections hierarchy toggle
  kHierarchyOff: 0,
  kHierarchyOn: 1,

  _toggleHierarchy: function(val) {
    let sidebarDoc = document.getElementById("sidebar").contentWindow;
    let lchecked = document.getElementById("viewSnowlList").hasAttribute("checked");
    if (lchecked) {
      sidebarDoc.CollectionsView.isHierarchical = val;
      sidebarDoc.CollectionsView._buildCollectionTree();
    }

    let rivertab = this._snowlRiverTab();
    if (rivertab) {
      let tabWindowDoc = gBrowser.getBrowserAtIndex(rivertab._tPos).contentWindow;
      let tabDoc = new XPCNativeWrapper(tabWindowDoc).wrappedJSObject;
      tabDoc.CollectionsView.isHierarchical = val;
      tabDoc.CollectionsView._buildCollectionTree();
    }

    this._prefs.set("collection.hierarchicalView", val);
  },

  // Need to init onLoad due to xul structure, toolbar exists in list and stream
  _initSnowlToolbar: function() {
    let menuitem = document.getElementById("snowlToolbarMenuitem");
    let doc = document.getElementById("sidebar").contentDocument;
    let toolbar = doc.getElementById("snowlToolbar");

    if (toolbar) {
      menuitem.setAttribute("checked", !toolbar.hidden);
    }
  },

  _toggleToolbar: function(event) {
    let name = event.target.getAttribute("name");
    let menuitem = document.getElementById(name+"Menuitem");
    let doc, toolbar, rtoolbar = null;

    if (name == "snowlToolbar") {
      doc = document.getElementById("sidebar").contentDocument;
      let rivertab = this._snowlRiverTab();
      if (rivertab)
        rtoolbar = gBrowser.getBrowserAtIndex(rivertab._tPos).
                   contentDocument.getElementById(name);
    }
    else 
      doc = document;

    toolbar = doc.getElementById(name);
    if (toolbar) {
      toolbar.hidden = !toolbar.hidden;
      menuitem.setAttribute("checked", !toolbar.hidden);
    }
    if (rtoolbar)
      rtoolbar.hidden = !rtoolbar.hidden;


  },

  // See if River tab exists
  _snowlRiverTab: function() {
    // Could be null if none else a reference to the tab
    let gBrowser = document.getElementById("content");
    let snowlTab = null;
    let snowlTabOpen = false;
    
    for (let index = 0; index < gBrowser.mTabs.length && !snowlTabOpen; index++) {
      // Get the next tab
      let currentTab = gBrowser.mTabs[index];
      if (currentTab.hasAttribute("snowl")) {
        snowlTabOpen = true;
        snowlTab = currentTab;
      }
    }
    return snowlTab;
  },

  // Need to init snowl River tab, if exists
  _initSnowlRiverTab: function() {
    let tabIndex = parseInt(this._mainWindow.getAttribute("snowltabindex"));
    if (tabIndex >= 0 && tabIndex <= gBrowser.mTabs.length)
      gBrowser.mTabs[tabIndex].setAttribute("snowl", "river");

    let riverbroadcaster = document.getElementById("viewSnowlRiver");
    let isRiverTab = gBrowser.selectedTab.hasAttribute("snowl");
    if (riverbroadcaster)
      riverbroadcaster.setAttribute("checked", isRiverTab);
  },

  // Need to reset snowl River tab index
  _resetSnowlRiverTabIndex: function () {
    setTimeout(function() {
      let snowlRiverTab = Snowl._snowlRiverTab();
      if (snowlRiverTab) {
        // River tab exists
        let newIndex = snowlRiverTab._tPos;
        Snowl._mainWindow.setAttribute("snowltabindex", newIndex);
      }
      else
        // Tab closed or none, remove it
        Snowl._mainWindow.removeAttribute("snowltabindex");
    }, 200)
  },

};

Cu.import("resource://snowl/modules/Preferences.js", Snowl);

window.addEventListener("load", function() { Snowl.init() }, false);
