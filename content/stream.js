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

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that come with Firefox
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// modules that should come with Firefox
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/Observers.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/utils.js");

const XML_NS = "http://www.w3.org/XML/1998/namespace"
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";

let gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIWebNavigation).
                     QueryInterface(Ci.nsIDocShellTreeItem).
                     rootTreeItem.
                     QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIDOMWindow);

let gMessageViewWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                         getInterface(Ci.nsIWebNavigation).
                         QueryInterface(Ci.nsIDocShellTreeItem).
                         rootTreeItem.
                         QueryInterface(Ci.nsIInterfaceRequestor).
                         getInterface(Ci.nsIDOMWindow);

let SnowlMessageView = {
  get _log() {
    delete this._log;
    return this._log = Log4Moz.Service.getLogger("Snowl.Stream");
  },

  // Favicon Service
  get _faviconSvc() {
    let faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                     getService(Ci.nsIFaviconService);
    delete this._faviconSvc;
    this._faviconSvc = faviconSvc;
    return this._faviconSvc;
  },

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    delete this._obsSvc;
    this._obsSvc = obsSvc;
    return this._obsSvc;
  },

  _window: null,
  _document: null,

  // The set of messages to display in the view.
  _collection: null,

  // the width (narrower dimension) of the vertical and horizontal scrollbars;
  // useful for calculating the viewable size of the viewport, since window.
  // innerWidth and innerHeight include the area taken up by the scrollbars
  // XXX Is this value correct, and does it vary by platform?
  scrollbarWidth: 15,

  get stylesheet() {
    for (let i = 0; i < document.styleSheets.length; i++)
      if (document.styleSheets[i].href == "chrome://snowl/content/stream.css")
        return document.styleSheets[i];
    return null;
  },

  _updateRule: function(position, newValue) {
    this.stylesheet.deleteRule(position);
    this.stylesheet.insertRule(newValue, position);
  },


  // This regex is designed to match URLs in plain text.  It correctly
  // excludes puncuation at the end of the URL, so in "See http://example.com."
  // it matches "http://example.com", not "http://example.com.".
  // Based on http://www.perl.com/doc/FMTEYEWTK/regexps.html
  get _linkifyRegex() {
    let protocols = "(?:" + ["http", "https", "ftp"].join("|") + ")";
    let ltrs = '\\w';
    let gunk = '/#~:.?+=&%@!\\-';
    let punc = '.:?\\-';
    let any  = ltrs + gunk + punc;

    let regex = new RegExp(
      "\\b(" + protocols + ":[" + any + "]+?)(?=[" + punc + "]*[^" + any + "]|$)",
      "gi"
    );

    delete this._linkifyRegex;
    return this._linkifyRegex = regex;
  },

  // nsISupports
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
                                         Ci.nsISupportsWeakReference]),


  //**************************************************************************//
  // Initialization & Destruction

  onLoad: function() {
    Observers.add(this, "snowl:message:added");

    this.onResize();

    // Explicitly wrap |window| in an XPCNativeWrapper to make sure
    // it's a real native object! This will throw an exception if we
    // get a non-native object.
    this._window = new XPCNativeWrapper(window);
    this._document = this._window.document;

    this._collection = new SnowlCollection();

    // Only show a week's worth of messages.
    this._collection.constraints.push({
      expression: "received > (julianday('now', 'start of day') - 6)",
      parameters: {}
    });

    this._collection.sortProperties = ["received", "timestamp"];
    this._collection.sortOrder = -1;
    this._collection.sort();
    this._rebuildView();

    this._setMidnightTimout();

    gBrowserWindow.Snowl._initSnowlToolbar();
  },

  onunLoad: function() {
    Observers.remove(this, "snowl:message:added");
  },

  _setMidnightTimout: function() {
    let t = this;
    let now = new Date();
    let msUntilMidnight = SnowlDateUtils.tomorrow - now;
    this._log.info("setting midnight timeout for " + new Date(now.getTime() + msUntilMidnight));
    window.setTimeout(function() { t.onMidnight() }, msUntilMidnight);
  },


  //**************************************************************************//
  // Event & Notification Handlers

  // nsIObserver
  observe: function(subject, topic, data) {
    switch (topic) {
      case "snowl:message:added":
        this._onMessageAdded(subject);
        break;
    }
  },

  onMidnight: function() {
    this._setMidnightTimout();
    this._rebuildView();
  },

  /**
   * Resize the content in the middle column based on the width of the viewport.
   * FIXME: file a bug on the problem that necessitates this hack.
   */
  onResize: function() {
    // We anticipate that there will be a scrollbar, so we include it
    // in the calculation.  Perhaps we should instead wait to include
    // the scrollbar until the content actually overflows.
    // XXX Why do we have to subtract *double* the width of the scrollbar???
    let width = window.innerWidth - (this.scrollbarWidth * 2) - 24 - 16;
    this._updateRule(0, ".body > * { width: " + width + "px }");
  },

  _onMessageAdded: function(message) {
    //dump("_onMessageAdded: " + (message ? message.subject : "null message") + "\n");
    //Cu.reportError("_onMessageAdded: " + (message ? message.subject : "null message"));

    this._contentSandbox.messages = this._document.getElementById("contentBox").
                                    getElementsByClassName("groupBox")[0];
    this._contentSandbox.messageBox = this._buildMessageView(message);

    let codeStr = "messages.insertBefore(messageBox, messages.firstChild)";
    Cu.evalInSandbox(codeStr, this._contentSandbox);

    this._contentSandbox.messages = null;
    this._contentSandbox.messageBox = null;
  },

  onToggleGroup: function(event) {
    event.target.nextSibling.style.display = event.target.checked ? "block" : "none";
  },


  //**************************************************************************//
  // Safe DOM Manipulation

  /**
   * Use this sandbox to run any DOM manipulation code on nodes
   * which are already inserted into the content document.
   */
  get _contentSandbox() {
    delete this._contentSandbox;
    return this._contentSandbox = new Cu.Sandbox(this._window);
  },

  // FIXME: use this when setting story title and byline.
  _setContentText: function FW__setContentText(id, text) {
    this._contentSandbox.element = this._document.getElementById(id);
    this._contentSandbox.textNode = this._document.createTextNode(text);
    let codeStr =
      "while (element.hasChildNodes()) " +
      "  element.removeChild(element.firstChild);" +
      "element.appendChild(textNode);";
    Cu.evalInSandbox(codeStr, this._contentSandbox);
    this._contentSandbox.element = null;
    this._contentSandbox.textNode = null;
  },

  // FIXME: use this when linkifying the story title and source.
  /**
   * Safely sets the href attribute on an anchor tag, providing the URI 
   * specified can be loaded according to rules.
   *
   * XXX Renamed from safeSetURIAttribute to unsafeSetURIAttribute to reflect
   * that we've commented out the stuff that makes it safe.
   *
   * FIXME: I don't understand the security implications here, but presumably
   * there's a reason this is here, and we should be respecting it, so make this
   * work by giving each message in a collection have a reference to its source
   * and then use the source's URI to create the principal with which we compare
   * the URI.
   * 
   * @param   element
   *          The element to set a URI attribute on
   * @param   attribute
   *          The attribute of the element to set the URI to, e.g. href or src
   * @param   uri
   *          The URI spec to set as the href
   */
  _unsafeSetURIAttribute: 
  function FW__unsafeSetURIAttribute(element, attribute, uri) {
/*
    let secman = Cc["@mozilla.org/scriptsecuritymanager;1"].
                 getService(Ci.nsIScriptSecurityManager);    
    const flags = Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL;
    try {
      secman.checkLoadURIStrWithPrincipal(this._feedPrincipal, uri, flags);
      // checkLoadURIStrWithPrincipal will throw if the link URI should not be
      // loaded, either because our feedURI isn't allowed to load it or per
      // the rules specified in |flags|, so we'll never "linkify" the link...
    }
    catch (e) {
      // Not allowed to load this link because secman.checkLoadURIStr threw
      return;
    }
*/

    this._contentSandbox.element = element;
    this._contentSandbox.uri = uri;
    let codeStr = "element.setAttribute('" + attribute + "', uri);";
    Cu.evalInSandbox(codeStr, this._contentSandbox);
  },


  //**************************************************************************//
  // Content Generation

  /**
   * A JavaScript Strands Future with which we pause the writing of messages
   * so as not to hork the UI thread.
   */
  _rebuildViewFuture: null,

  /**
   * Sleep the specified number of milliseconds before continuing at the point
   * in the caller where this function was called.  For the most part, this is
   * a generic sleep routine like the one provided by JavaScript Strands,
   * but we store the Future this function creates in the _rebuildViewFuture
   * property so we can interrupt it when writeMessages gets called again
   * while it is currently writing messages.
   */
  _sleepRebuildView: strand(function(millis) {
    this._rebuildViewFuture = new Future();
    setTimeout(this._rebuildViewFuture.fulfill, millis);
    yield this._rebuildViewFuture.result();
  }),

  _rebuildView: strand(function() {
    let begin = new Date();

    // Interrupt a strand currently writing messages so we don't both try
    // to write messages at the same time.
    // FIXME: figure out how to suppress the exception this throws to the error
    // console, since this interruption is expected and normal behavior.
    if (this._rebuildViewFuture)
      this._rebuildViewFuture.interrupt();

    let contentBox = this._document.getElementById("contentBox");
    while (contentBox.hasChildNodes())
      contentBox.removeChild(contentBox.lastChild);

    this._contentSandbox.messages = contentBox;

    let groups = [
      { name: "The Future", epoch: Number.MAX_VALUE },
      { name: "Today", epoch: SnowlDateUtils.today },
      { name: "Yesterday", epoch: SnowlDateUtils.yesterday },
      { name: SnowlDateUtils.twoDaysAgo.name, epoch: SnowlDateUtils.twoDaysAgo.epoch },
      { name: SnowlDateUtils.threeDaysAgo.name, epoch: SnowlDateUtils.threeDaysAgo.epoch },
      { name: SnowlDateUtils.fourDaysAgo.name, epoch: SnowlDateUtils.fourDaysAgo.epoch },
      { name: SnowlDateUtils.fiveDaysAgo.name, epoch: SnowlDateUtils.fiveDaysAgo.epoch },
      { name: SnowlDateUtils.sixDaysAgo.name, epoch: SnowlDateUtils.sixDaysAgo.epoch },
      { name: "Older", epoch: 0 }
    ];

    let groupIndex = 0;

    for (let i = 0; i < this._collection.messages.length; ++i) {
      let message = this._collection.messages[i];

      while (message.received < groups[groupIndex].epoch) {
        ++groupIndex;

        let header = this._document.createElementNS(XUL_NS, "checkbox");
        header.className = "groupHeader";
        header.setAttribute("label", groups[groupIndex].name);
        header.setAttribute("checked", "true");
        let listener = function(evt) { SnowlMessageView.onToggleGroup(evt) };
        header.addEventListener("command", listener, false);

        let container = this._document.createElementNS(XUL_NS, "vbox");
        container.className = "groupBox";
        this._contentSandbox.messages = container;

        contentBox.appendChild(header);
        contentBox.appendChild(container);
      }

      let messageBox = this._buildMessageView(message);

      this._contentSandbox.messageBox = messageBox;

      let codeStr = "messages.appendChild(messageBox)";
      Cu.evalInSandbox(codeStr, this._contentSandbox);

      // Sleep after every tenth message so we don't hork the UI thread and users
      // can immediately start reading messages while we finish writing them.
      if (!(i % 10))
        yield this._sleepRebuildView(0);
    }

    this._contentSandbox.messages = null;
    this._contentSandbox.messageBox = null;

    this._log.info("time spent building view: " + (new Date() - begin) + "ms\n");

    //let serializer = Cc["@mozilla.org/xmlextras/xmlserializer;1"].
    //                 createInstance(Ci.nsIDOMSerializer);
    //this._log.info(serializer.serializeToString(document.getElementById("contentBox")));
  }),

  _buildMessageView: function(message) {
    let messageBox = this._document.createElementNS(XUL_NS, "hbox");
    messageBox.className = "message";

    // left column
    let leftColumn = this._document.createElementNS(XUL_NS, "vbox");
    leftColumn.className = "leftColumn";
    let icon = document.createElementNS(XUL_NS, "image");
    icon.className = "icon";
    if (message.authorIcon) {
      icon.setAttribute("src", message.authorIcon);
    }
    else {
      let sourceFaviconURI = message.source.humanURI || URI.get("urn:use-default-icon");
      icon.setAttribute("src", this._faviconSvc.getFaviconImageForPage(sourceFaviconURI).spec);
    }
    leftColumn.appendChild(icon);
    messageBox.appendChild(leftColumn);

    // center column
    let centerColumn = this._document.createElementNS(XUL_NS, "vbox");
    centerColumn.className = "centerColumn";
    messageBox.appendChild(centerColumn);

    // Author or Source
    if (message.author || message.source) {
      let desc = this._document.createElementNS(XUL_NS, "description");
      desc.className = "author";
      desc.setAttribute("crop", "end");
      desc.setAttribute("value", message.author || message.source.name);
      centerColumn.appendChild(desc);
    }

    // Timestamp
    // Commented out because the timestamp isn't that useful when we order
    // by time received.  Instead, we're going to group by time period
    // received (this morning, yesterday, last week, etc.) to give users
    // useful chronographic info.
    //let lastUpdated = SnowlDateUtils._formatDate(message.timestamp);
    //if (lastUpdated) {
    //  let timestamp = this._document.createElementNS(XUL_NS, "description");
    //  timestamp.className = "timestamp";
    //  timestamp.setAttribute("crop", "end");
    //  timestamp.setAttribute("value", lastUpdated);
    //  centerColumn.appendChild(timestamp);
    //}

    // content (title or short message)
    let body = this._document.createElementNS(XUL_NS, "description");
    body.className = "body";
    let div = this._document.createElementNS(HTML_NS, "div");
    let a = this._document.createElementNS(HTML_NS, "a");
    // FIXME: make this localizable.
    let subject = message.subject || "empty message";

    if (message.link) {
      let a = this._document.createElementNS(HTML_NS, "a");
      this._unsafeSetURIAttribute(a, "href", message.link);
      body.className += " text-link";
      a.appendChild(this._document.createTextNode(subject));
      div.appendChild(a);
    }
    else {
      // Split the text into its plaintext and URL parts, which alternate
      // in the array of results, with the first part always being plaintext.
      // FIXME: turn this whole block into a function that other views
      // can use.
      let parts = subject.split(this._linkifyRegex);
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 == 0)
          div.appendChild(this._document.createTextNode(parts[i]));
        else {
          // This is a bit hacky.  In theory, I should need either a XUL
          // description tag of class="text-link" or an HTML a tag, but the
          // description tag opens a new window when you click on it,
          // and the a tag doesn't look like a link.  Using both results in
          // the correct appearance and behavior, but it's overcomplicated.
          // FIXME: fix this here and above, where we handle message.link.
          let desc = this._document.createElementNS(XUL_NS, "description");
          desc.className = "text-link";
          let a = this._document.createElementNS(HTML_NS, "a");
          this._unsafeSetURIAttribute(a, "href", parts[i]);
          a.appendChild(this._document.createTextNode(parts[i]));
          desc.appendChild(a);
          div.appendChild(desc);
        }
      }
    }

    body.appendChild(div);
    centerColumn.appendChild(body);

    // Source
    //let source = this._document.createElementNS(HTML_NS, "a");
    //source.className = "source";
    //let sourceIcon = document.createElementNS(HTML_NS, "img");
    //let sourceFaviconURI = message.source.humanURI || URI.get("urn:use-default-icon");
    //sourceIcon.src = this._faviconSvc.getFaviconImageForPage(sourceFaviconURI).spec;
    //source.appendChild(sourceIcon);
    //source.appendChild(this._document.createTextNode(message.source.name));
    //if (message.source.humanURI)
    //  this._unsafeSetURIAttribute(source, "href", message.source.humanURI.spec);
    //centerColumn.appendChild(source);

    // right column
    let rightColumn = this._document.createElementNS(XUL_NS, "vbox");
    rightColumn.className = "rightColumn";
    messageBox.appendChild(rightColumn);

    return messageBox;
  }

};
