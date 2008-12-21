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
// FIXME: remove this import of XPCOMUtils, as it is no longer being used.
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/utils.js");
Cu.import("resource://snowl/modules/twitter.js");
Cu.import("resource://snowl/modules/service.js");

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
    return this._log = Log4Moz.repository.getLogger("Snowl.Stream");
  },

  get _faviconSvc() {
    delete this._faviconSvc;
    return this._faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                              getService(Ci.nsIFaviconService);
  },

  get _writeButton() {
    delete this._writeButton;
    return this._writeButton = document.getElementById("snowlWriteButton");
  },

  get _writeForm() {
    delete this._writeForm;
    return this._writeForm = document.getElementById("writeForm");
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


  //**************************************************************************//
  // Initialization & Destruction

  onLoad: function() {
    Observers.add(this, "snowl:message:added");
    Observers.add(this, "snowl:sources:changed");

    this.onResize();

    // Explicitly wrap |window| in an XPCNativeWrapper to make sure
    // it's a real native object! This will throw an exception if we
    // get a non-native object.
    this._window = new XPCNativeWrapper(window);
    this._document = this._window.document;

    this._collection = new SnowlCollection();

    // Show the last couple hundred messages.
    // We used to show all messages within a certain time period, like the last
    // week or the last day, but the purpose of the stream view is to let users
    // glance at recent activity as it scrolls by, not browse messages over long
    // periods of time, and a week's worth of messages is too many to usefully
    // browse in the view.  And a day's worth of messages means that if you start
    // your browser after not having used it for a day, you'll see nothing
    // in the view when you first open it, which is confusing and unexpected.
    this._collection.limit = 250;

    // We sort by ID in order to do an implicit sort on received time
    // (so that we show messages in the order they are received) while making
    // sure that we always show messages in the same order even when their
    // received times are the same.
    //
    // We could instead sort by received and timestamp, to show messages
    // as they are received, with messages received at the same time being
    // sorted by timestamp; but since we add messages to the view as they
    // are received, regardless of their timestamp, doing that would cause
    // there to be a difference between what the user sees when they leave
    // the view open (and messages accumulate in it over time) versus what
    // they see when they open it anew.
    this._collection.sortProperties = ["id"];
    this._collection.sortOrder = -1;
    this._collection.sort();
    this._rebuildView();

    this._initWriteForm();
    this._updateWriteButton();
  },

  onunLoad: function() {
    Observers.remove(this, "snowl:message:added");
    Observers.remove(this, "snowl:sources:changed");
  },

  _initWriteForm: function() {
    // For some reason setting hidden="true" in the XUL file prevents us
    // from showing the box later via writeForm.hidden = false, so we set it
    // here instead.
    // FIXME: file a bug on this abnormality.
    this._writeForm.hidden = true;
  },

  // Selectively enable/disable the button for writing a message depending on
  // whether or not the user has an account that supports writing.
  _updateWriteButton: function() {
    this._writeButton.disabled = (SnowlService.targets.length == 0);
  },


  //**************************************************************************//
  // Event & Notification Handlers

  // nsIObserver
  observe: function(subject, topic, data) {
    switch (topic) {
      case "snowl:message:added":
        this._onMessageAdded(subject);
        break;
      case "snowl:sources:changed":
        this._onSourcesChanged();
        break;
    }
  },

  /**
   * Resize the content in the middle column based on the width of the viewport.
   * FIXME: file a bug on the problem that necessitates this hack.
   */
  onResize: function() {
    const LEFT_COLUMN_WIDTH  =  24 + 4; // 24px width + 4px right margin
    const RIGHT_COLUMN_WIDTH =  16 + 2; // 16px width + 2px left margin

    // Calculate the width of the middle column and set it (along with some
    // of its contents to that width).  See the comments in stream.css
    // for more info on why we set each of these rules.

    // We anticipate that there will be a scrollbar, so we include it
    // in the calculation.  Perhaps we should instead wait to include it
    // until the content actually overflows.

    // window.innerWidth == document.documentElement.boxObject.width == document.documentElement.clientWidth,
    // and I know of no reason to prefer one over the other, except that
    // clientWidth only works in Firefox 3.1+, and we support Firefox 3.0,
    // so one of the others is better.

    let width = window.innerWidth - this.scrollbarWidth - LEFT_COLUMN_WIDTH - RIGHT_COLUMN_WIDTH;
    this._updateRule(1, ".body { min-width: " + width + "px; max-width: " + width + "px }");
    this._updateRule(2, ".body > div { min-width: " + width + "px; max-width: " + width + "px }");
    this._updateRule(3, ".centerColumn { min-width: " + width + "px; max-width: " + width + "px }");
  },

  _onMessageAdded: function(message) {
    this._contentSandbox.messages = this._document.getElementById("contentBox");
    this._contentSandbox.messageBox = this._buildMessageView(message);

    let codeStr = "messages.insertBefore(messageBox, messages.firstChild)";
    Cu.evalInSandbox(codeStr, this._contentSandbox);

    this._contentSandbox.messages = null;
    this._contentSandbox.messageBox = null;
  },

  _onSourcesChanged: function() {
    this._updateWriteButton();
    this._rebuildView();
  },

  onToggleGroup: function(event) {
    event.target.nextSibling.style.display = event.target.checked ? "block" : "none";
  },

  onRefresh: function() {
    SnowlService.refreshAllSources();
  },

  onToggleWrite: function(event) {
    this._writeForm.hidden = !event.target.checked;
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

    for (let i = 0; i < this._collection.messages.length; ++i) {
      let message = this._collection.messages[i];

      let messageBox = this._buildMessageView(message);

      this._contentSandbox.messageBox = messageBox;

      let codeStr = "messages.appendChild(messageBox)";
      Cu.evalInSandbox(codeStr, this._contentSandbox);

      // Sleep a bit after every message so we don't hork the UI thread and users
      // can immediately start reading messages while we finish writing them.
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

    // Content (subject or excerpt)
    let body = this._document.createElementNS(XUL_NS, "description");
    body.className = "body";
    let div = this._document.createElementNS(HTML_NS, "div");
    let a = this._document.createElementNS(HTML_NS, "a");

    let content = message.subject || message.excerpt;

    if (message.link) {
      let a = this._document.createElementNS(HTML_NS, "a");
      this._unsafeSetURIAttribute(a, "href", message.link);
      body.className += " text-link";
      a.appendChild(this._document.createTextNode(content));
      div.appendChild(a);
    }
    else {
      // Split the text into its plaintext and URL parts, which alternate
      // in the array of results, with the first part always being plaintext.
      // FIXME: turn this whole block into a function that other views
      // can use.
      let parts = content.split(this._linkifyRegex);
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
