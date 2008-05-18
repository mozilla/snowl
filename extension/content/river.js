/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
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
 * The Original Code is the Feed Subscribe Handler.
 *
 * The Initial Developer of the Original Code is Google Inc.
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Ben Goodger <beng@google.com>
 *   Asaf Romano <mano@mozilla.com>
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

Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/URI.js");

let log = Log4Moz.Service.getLogger("Snowl.River");

/**
 * Wrapper function for nsIIOService::newURI.
 * @param aURLSpec
 *        The URL string from which to create an nsIURI.
 * @returns an nsIURI object, or null if the creation of the URI failed.
 */
function makeURI(aURLSpec, aCharset) {
  var ios = Cc["@mozilla.org/network/io-service;1"].
            getService(Ci.nsIIOService);
  try {
    return ios.newURI(aURLSpec, aCharset, null);
  } catch (ex) { }

  return null;
}

const XML_NS = "http://www.w3.org/XML/1998/namespace"
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const URI_BUNDLE = "chrome://browser/locale/feeds/subscribe.properties";

const TITLE_ID = "feedTitleText";
const SUBTITLE_ID = "feedSubtitleText";

/**
 * Converts a number of bytes to the appropriate unit that results in a
 * number that needs fewer than 4 digits
 *
 * @return a pair: [new value with 3 sig. figs., its unit]
  */
function convertByteUnits(aBytes) {
  var units = ["bytes", "kilobyte", "megabyte", "gigabyte"];
  let unitIndex = 0;
 
  // convert to next unit if it needs 4 digits (after rounding), but only if
  // we know the name of the next unit
  while ((aBytes >= 999.5) && (unitIndex < units.length - 1)) {
    aBytes /= 1024;
    unitIndex++;
  }
 
  // Get rid of insignificant bits by truncating to 1 or 0 decimal points
  // 0 -> 0; 1.2 -> 1.2; 12.3 -> 12.3; 123.4 -> 123; 234.5 -> 235
  aBytes = aBytes.toFixed((aBytes > 0) && (aBytes < 100) ? 1 : 0);
 
  return [aBytes, units[unitIndex]];
}

var RiverView = {
  // Date Formatting Service
  get _dfSvc() {
    let dfSvc = Cc["@mozilla.org/intl/scriptabledateformat;1"].
                getService(Ci.nsIScriptableDateFormat);
    delete this._dfSvc;
    this._dfSvc = dfSvc;
    return this._dfSvc;
  },

  // Favicon Service
  get _faviconSvc() {
    let faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                     getService(Ci.nsIFaviconService);
    delete this._faviconSvc;
    this._faviconSvc = faviconSvc;
    return this._faviconSvc;
  },

  get _orderButton() {
    let orderButton = document.getElementById("orderButton");
    delete this._orderButton;
    this._orderButton = orderButton;
    return this._orderButton;
  },

  get _unreadButton() {
    let unreadButton = document.getElementById("unreadButton");
    delete this._unreadButton;
    this._unreadButton = unreadButton;
    return this._unreadButton;
  },

  // The set of messages to display in the view.
  _collection: null,
  
  init: function SH_init() {
    // Explicitly wrap |window| in an XPCNativeWrapper to make sure
    // it's a real native object! This will throw an exception if we
    // get a non-native object.
    this._window = new XPCNativeWrapper(window);
    this._document = this._window.document;

    this._collection = new SnowlCollection(null, null, true);

    this.rebuildSourceMenu();

    this._updateToolbar();

    this.writeContent();
  },

  _updateToolbar: function() {
    this._params = {};
    let query = window.location.search.substr(1);
    for each (let param in query.split("&")) {
      let name, value;
      if (param.indexOf("=") != -1) {
        [name, value] = param.split("=");
        value = decodeURIComponent(value);
      }
      else
        name = param;
      this._params[name] = value;
    }

    if ("unread" in this._params) {
      this._collection.read = false;
      this._unreadButton.checked = true;
    }

    if ("filter" in this._params) {
      this._collection.filter = this._params.filter;
      document.getElementById("filterTextbox").value = this._params.filter;
    }

    if ("sourceID" in this._params) {
      this._collection.sourceID = this._params.sourceID;
      let menu = document.getElementById("sourceMenu");
      let item;
      for (let i = 0; item = menu.getItemAtIndex(i); i++) {
        if (item.value == this._params.sourceID) {
          menu.selectedItem = item;
          break;
        }
      }
    }

    if ("order" in this._params) {
      switch(this._params.order) {
        case "descending":
          this._setOrder(-1);
          break;
        case "ascending":
        default:
          this._setOrder(1);
          break;
      }
    }
  },

  onCommandUnreadButton: function(aEvent) {
    // FIXME: instead of rebuilding from scratch each time, when going from
    // all to unread, simply hide the ones that are read (f.e. by setting a CSS
    // class on read items and then using a CSS rule to hide them).

    if (this._unreadButton.checked) {
      this._collection.read = false;
      this.rebuildView();
    }
    else {
      this._collection.read = undefined;
      this.rebuildView();
    }

    this._updateURI();
  },

  onCommandOrderButton: function(aEvent) {
    // checkState can be either 0, 1, or 2.  The default is 0, which means
    // to sort in ascending order.  The value 1 means to sort in descending
    // order.  The value 2 is undefined, but users can't make the button
    // switch to that state; it must be set programmatically, and we don't
    // use it (presumably we could one day make it mean "sort randomly").

    switch(this._orderButton.checked) {
      case true:
        this._setOrder(-1);
        break;
      case false:
      default:
        this._setOrder(1);
        break;
    }

    // Presumably here we could do messages.reverse(), which would be faster,
    // but can we be sure the messages started in the reverse of the new state?
    this._collection.sort(this._collection.sortProperty,
                          this._collection.sortOrder);

    this.rebuildView();
    this._updateURI();
  },

  _setOrder: function(aOrder) {
    switch (aOrder) {
      case -1:
        this._collection.sortOrder = -1;
        this._orderButton.checkState = 1;
        this._orderButton.checked = true;
        this._orderButton.image = "chrome://snowl/content/arrow-up.png";
        break;
      case 1:
      default:
        this._collection.sortOrder = 1;
        this._orderButton.checkState = 0;
        this._orderButton.checked = false;
        this._orderButton.image = "chrome://snowl/content/arrow-down.png";
        break;
    }
  },

  onCommandFilterTextbox: function(aEvent, aFilterTextbox) {
    this._collection.filter = aFilterTextbox.value;
    this.rebuildView();
    this._updateURI();
  },

  onCommandSourceMenu: function(aEvent) {
    let sourceMenu = document.getElementById("sourceMenu");
    this._collection.sourceID = sourceMenu.selectedItem.value;
    this.rebuildView();
    this._updateURI();
  },

  _updateURI: function() {
    let params = [];

    if (typeof this._collection.read != "undefined" && !this._collection.read)
      params.push("unread");

    if (this._collection.filter)
      params.push("filter=" + encodeURIComponent(this._collection.filter));

    if (this._collection.sourceID)
      params.push("sourceID=" + encodeURIComponent(this._collection.sourceID));

    if (this._collection.sortOrder == -1)
      params.push("order=descending");

    let query = params.length > 0 ? "?" + params.join("&") : "";
    let spec = "chrome://snowl/content/river.xhtml" + query;
    let uri = Cc["@mozilla.org/network/io-service;1"].
              getService(Ci.nsIIOService).
              newURI(spec, null, null);

    let gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                         getInterface(Ci.nsIWebNavigation).
                         QueryInterface(Ci.nsIDocShellTreeItem).
                         rootTreeItem.
                         QueryInterface(Ci.nsIInterfaceRequestor).
                         getInterface(Ci.nsIDOMWindow);

    // Update the docshell with the new URI.  This updates the location bar
    // and gets used by the bookmarks service when the user bookmarks the page.
    gBrowserWindow.gBrowser.docShell.setCurrentURI(uri);

    // Update the session history entry for the page with the new URI.
    // This gets used when the user reloads the page or traverses history.
    let history = gBrowserWindow.gBrowser.sessionHistory;
    let historyEntry = history.getEntryAtIndex(history.index, false);
    if (historyEntry instanceof Ci.nsISHEntry)
      historyEntry.setURI(uri);
    else
      this._log.error("can't update session history URI for " +
                      "'" + historyEntry.title + "' " +
                      "<" + historyEntry.URI.spec + ">; " +
                      "entry is not an instance of nsISHEntry");
  },

  onScroll: function(aEvent) {
    // The "current message" is the topmost one whose header appears on the page
    // 
    var scrollTop = window.scrollTop;
    //dump(document.elementFromPoint(100, 0) + "\n");

    // FIXME: pick the x coordinate based on the actual position of the content
    // rather than using an arbitrary value.

    let node = document.elementFromPoint(100, 0);
    while (node.getAttribute("class") != "entry" && node.parentNode)
      node = node.parentNode;

    //dump(node + " " + node.getAttribute("class") + "\n");

    // FIXME: make sure we haven't found some element within a entry's content
    // that happens to have class="entry" set on it.
    if (node.getAttribute("class") == "entry") {
      let index = node.getAttribute("index");
      for (let i = 0; i <= index; i++)
        this._collection.messages[i].read = true;
    }

  },



  get _log() {
    let log = Log4Moz.Service.getLogger("Snowl.River");
    this.__defineGetter__("_log", function() { return log });
    return this._log;
  },

  _mimeSvc      : Cc["@mozilla.org/mime;1"].
                  getService(Ci.nsIMIMEService),

  _setContentText: function FW__setContentText(id, text) {
    this._contentSandbox.element = this._document.getElementById(id);
    this._contentSandbox.textNode = this._document.createTextNode(text);
    var codeStr =
      "while (element.hasChildNodes()) " +
      "  element.removeChild(element.firstChild);" +
      "element.appendChild(textNode);";
    Cu.evalInSandbox(codeStr, this._contentSandbox);
    this._contentSandbox.element = null;
    this._contentSandbox.textNode = null;
  },

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
    var secman = Cc["@mozilla.org/scriptsecuritymanager;1"].
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
    var codeStr = "element.setAttribute('" + attribute + "', uri);";
    Cu.evalInSandbox(codeStr, this._contentSandbox);
  },

  /**
   * Use this sandbox to run any dom manipulation code on nodes which
   * are already inserted into the content document.
   */
  __contentSandbox: null,
  get _contentSandbox() {
    if (!this.__contentSandbox)
      this.__contentSandbox = new Cu.Sandbox(this._window);

    return this.__contentSandbox;
  },

  __bundle: null,
  get _bundle() {
    if (!this.__bundle) {
      this.__bundle = Cc["@mozilla.org/intl/stringbundle;1"].
                      getService(Ci.nsIStringBundleService).
                      createBundle(URI_BUNDLE);
    }
    return this.__bundle;
  },

  _getFormattedString: function FW__getFormattedString(key, params) {
    return this._bundle.formatStringFromName(key, params, params.length);
  },
  
  _getString: function FW__getString(key) {
    return this._bundle.GetStringFromName(key);
  },

   /**
   * Returns a date suitable for displaying in the feed preview. 
   * If the date cannot be parsed, the return value is "false".
   * @param   dateString
   *          A date as extracted from a feed entry. (entry.updated)
   */
  _parseDate: function FW__parseDate(dateString) {
    // Convert the date into the user's local time zone
    dateObj = new Date(dateString);

    // Make sure the date we're given is valid.
    if (!dateObj.getTime())
      return false;

    var dateService = Cc["@mozilla.org/intl/scriptabledateformat;1"].
                      getService(Ci.nsIScriptableDateFormat);
    return dateService.FormatDateTime("", dateService.dateFormatLong, dateService.timeFormatNoSeconds,
                                      dateObj.getFullYear(), dateObj.getMonth()+1, dateObj.getDate(),
                                      dateObj.getHours(), dateObj.getMinutes(), dateObj.getSeconds());
  },

  /**
   * Writes the feed title into the preview document.
   * @param   container
   *          The feed container
   */
  _setTitleText: function FW__setTitleText(container) {
    if (container.title) {
      this._setContentText(TITLE_ID, container.title.plainText());
      this._document.title = container.title.plainText();
    }

    var feed = container.QueryInterface(Ci.nsIFeed);
    if (feed && feed.subtitle)
      this._setContentText(SUBTITLE_ID, container.subtitle.plainText());
  },

  /**
   * Writes the title image into the preview document if one is present.
   * @param   container
   *          The feed container
   */
  _setTitleImage: function FW__setTitleImage(container) {
    try {
      var parts = container.image;
      
      // Set up the title image (supplied by the feed)
      var feedTitleImage = this._document.getElementById("feedTitleImage");
      this._unsafeSetURIAttribute(feedTitleImage, "src", 
                                parts.getPropertyAsAString("url"));

      // Set up the title image link
      var feedTitleLink = this._document.getElementById("feedTitleLink");

      var titleText = this._getFormattedString("linkTitleTextFormat", 
                                               [parts.getPropertyAsAString("title")]);
      this._contentSandbox.feedTitleLink = feedTitleLink;
      this._contentSandbox.titleText = titleText;
      var codeStr = "feedTitleLink.setAttribute('title', titleText);";
      Cu.evalInSandbox(codeStr, this._contentSandbox);
      this._contentSandbox.feedTitleLink = null;
      this._contentSandbox.titleText = null;

      this._unsafeSetURIAttribute(feedTitleLink, "href", 
                                parts.getPropertyAsAString("link"));

      // Fix the margin on the main title, so that the image doesn't run over
      // the underline
      var feedTitleText = this._document.getElementById("feedTitleText");
      var titleImageWidth = parseInt(parts.getPropertyAsAString("width")) + 15;
      feedTitleText.style.marginRight = titleImageWidth + "px";
    }
    catch (e) {
      this._log.info("Failed to set Title Image (this is benign): " + e);
    }
  },

  /**
   * A JavaScript Strands Future with which we pause the writing of messages
   * so as not to hork the UI thread.
   */
  _futureWriteMessages: null,

  /**
   * Sleep the specified number of milliseconds before continuing at the point
   * in the caller where this function was called.  For the most part, this is
   * a generic sleep routine like the one provided by JavaScript Strands,
   * but we store the Future this function creates in the _futureWriteMessages
   * property so we can interrupt it when writeMessages gets called again
   * while it is currently writing messages.
   */
  _sleepWriteMessages: strand(function(millis) {
    this._futureWriteMessages = new Future();
    setTimeout(this._futureWriteMessages.fulfill, millis);
    yield this._futureWriteMessages.result();
  }),

  _writeMessages: strand(function() {
    // Interrupt a strand currently writing messages so we don't both try
    // to write messages at the same time.
    // FIXME: figure out how to suppress the exception this throws to the error
    // console, since this interruption is expected and normal behavior.
    if (this._futureWriteMessages)
      this._futureWriteMessages.interrupt();

    this._contentSandbox.messagesContainer =
      this._document.getElementById("messagesContainer");

    for (let i = 0; i < this._collection.messages.length; ++i) {
      let message = this._collection.messages[i];

      // FIXME: make this a message rather than an message.
      let messageContainer = this._document.createElementNS(XUL_NS, "row");
      messageContainer.className = "message";
      messageContainer.setAttribute("index", i);

      {
        let originContainer = this._document.createElementNS(XUL_NS, "vbox");
        originContainer.className = "origin";

        if (message.author) {
          let author = this._document.createElementNS(XUL_NS, "label");
          author.setAttribute("crop", "end");
          author.setAttribute("value", message.author);
          originContainer.appendChild(author);
        }

        let source = this._document.createElementNS(XUL_NS, "description");
        source.className = "source";
        let a = this._document.createElementNS(HTML_NS, "a");
        let icon = document.createElementNS(HTML_NS, "img");
        let uri = message.source.humanURI || URI.get("urn:use-default-icon");
        icon.src = this._faviconSvc.getFaviconImageForPage(uri).spec;
        a.appendChild(icon);
        a.appendChild(this._document.createTextNode(message.source.name));
        if (message.source.humanURI)
          this._unsafeSetURIAttribute(a, "href", message.source.humanURI.spec);
        source.appendChild(a);
        originContainer.appendChild(source);

        messageContainer.appendChild(originContainer);
      }

      {
        let contentContainer = this._document.createElementNS(HTML_NS, "div");
        contentContainer.className = "content";

        if (message.subject) {
          let a = this._document.createElementNS(HTML_NS, "a");
          a.appendChild(this._document.createTextNode(message.subject));
  
          if (message.link)
            this._unsafeSetURIAttribute(a, "href", message.link);

          let subject = this._document.createElementNS(HTML_NS, "h3");
          subject.className = "subject";
          subject.appendChild(a);

          contentContainer.appendChild(subject);
        }

        let body = this._document.createElementNS(HTML_NS, "div");
        body.className = "body";

        let summary = message.content || message.summary;
        if (summary) {
          if (summary.base)
            body.setAttributeNS(XML_NS, "base", summary.base.spec);

          let docFragment = summary.createDocumentFragment(body);
          if (docFragment)
            body.appendChild(docFragment);

          // If the message doesn't have a subject, but it does have a link,
          // append a # permalink. See http://scripting.com/rss.xml for an example.
          if (!message.subject && message.link) {
            let a = this._document.createElementNS(HTML_NS, "a");
            a.appendChild(this._document.createTextNode("#"));
            this._unsafeSetURIAttribute(a, "href", message.link);
            body.appendChild(this._document.createTextNode(" "));
            body.appendChild(a);
          }
  
        }

        contentContainer.appendChild(body);

        if (message.enclosures && message.enclosures.length > 0) {
          let enclosuresDiv = this._buildEnclosureDiv(message);
          contentContainer.appendChild(enclosuresDiv);
        }

        messageContainer.appendChild(contentContainer);
      }

      {
        let timestampContainer = this._document.createElementNS(XUL_NS, "description");
        timestampContainer.className = "timestamp";

        // FIXME: message.timestamp should already be a date object.
        var lastUpdated = this._formatTimestamp(new Date(message.timestamp));
        if (lastUpdated)
          timestampContainer.appendChild(document.createTextNode(lastUpdated));

        messageContainer.appendChild(timestampContainer);
      }

      this._contentSandbox.messageContainer = messageContainer;

      var codeStr = "messagesContainer.appendChild(messageContainer);";
      Cu.evalInSandbox(codeStr, this._contentSandbox);

      // Sleep after every message so we don't hork the UI thread and users
      // can immediately start reading messages while we finish writing them.
      yield this._sleepWriteMessages(0);
    }

    this._contentSandbox.messagesContainer = null;
    this._contentSandbox.messageContainer = null;
  }),

  /**
   * Takes a url to a media item and returns the best name it can come up with.
   * Frequently this is the filename portion (e.g. passing in 
   * http://example.com/foo.mpeg would return "foo.mpeg"), but in more complex
   * cases, this will return the entire url (e.g. passing in
   * http://example.com/somedirectory/ would return 
   * http://example.com/somedirectory/).
   * @param aURL
   *        The URL string from which to create a display name
   * @returns a string
   */
  _getURLDisplayName: function FW__getURLDisplayName(aURL) {
    var url = makeURI(aURL);
    url.QueryInterface(Ci.nsIURL);
    if (url == null || url.fileName.length == 0)
      return aURL;

    return decodeURI(url.fileName);
  },

  /**
   * Takes a FeedEntry with enclosures, generates the HTML code to represent
   * them, and returns that.
   * @param   entry
   *          FeedEntry with enclosures
   * @returns element
   */
  _buildEnclosureDiv: function FW__buildEnclosureDiv(entry) {
    var enclosuresDiv = this._document.createElementNS(HTML_NS, "div");
    enclosuresDiv.className = "enclosures";

    enclosuresDiv.appendChild(this._document.createTextNode(this._getString("mediaLabel")));

    var roundme = function(n) {
      return (Math.round(n * 100) / 100).toLocaleString();
    }

    for (var i_enc = 0; i_enc < entry.enclosures.length; ++i_enc) {
      var enc = entry.enclosures.queryElementAt(i_enc, Ci.nsIWritablePropertyBag2);

      if (!(enc.hasKey("url"))) 
        continue;

      var enclosureDiv = this._document.createElementNS(HTML_NS, "div");
      enclosureDiv.setAttribute("class", "enclosure");

      var mozicon = "moz-icon://.txt?size=16";
      var type_text = null;
      var size_text = null;

      if (enc.hasKey("type")) {
        type_text = enc.get("type");
        try {
          var handlerInfoWrapper = this._mimeSvc.getFromTypeAndExtension(enc.get("type"), null);

          if (handlerInfoWrapper)
            type_text = handlerInfoWrapper.description;

          if  (type_text && type_text.length > 0)
            mozicon = "moz-icon://goat?size=16&contentType=" + enc.get("type");

        } catch (ex) { }

      }

      if (enc.hasKey("length") && /^[0-9]+$/.test(enc.get("length"))) {
        var enc_size = convertByteUnits(parseInt(enc.get("length")));

        var size_text = this._getFormattedString("enclosureSizeText", 
                             [enc_size[0], this._getString(enc_size[1])]);
      }

      var iconimg = this._document.createElementNS(HTML_NS, "img");
      iconimg.setAttribute("src", mozicon);
      iconimg.setAttribute("class", "type-icon");
      enclosureDiv.appendChild(iconimg);

      enclosureDiv.appendChild(this._document.createTextNode( " " ));

      var enc_href = this._document.createElementNS(HTML_NS, "a");
      enc_href.appendChild(this._document.createTextNode(this._getURLDisplayName(enc.get("url"))));
      this._unsafeSetURIAttribute(enc_href, "href", enc.get("url"));
      enclosureDiv.appendChild(enc_href);

      if (type_text && size_text)
        enclosureDiv.appendChild(this._document.createTextNode( " (" + type_text + ", " + size_text + ")"));

      else if (type_text) 
        enclosureDiv.appendChild(this._document.createTextNode( " (" + type_text + ")"))

      else if (size_text)
        enclosureDiv.appendChild(this._document.createTextNode( " (" + size_text + ")"))
 
      enclosuresDiv.appendChild(enclosureDiv);
    }

    return enclosuresDiv;
  },

  _window: null,
  _document: null,
  _feedURI: null,
  _feedPrincipal: null,

  writeContent: function FW_writeContent() {
    if (!this._window)
      return;

    try {
      // Set up the feed content
      //var container = this._getContainer();
      //if (!container)
      //  return;

      //this._setTitleText(container);
      //this._setTitleImage(container);
      this._writeMessages();
    }
    finally {
      //this._removeFeedFromCache();
    }
  },

  rebuildView: function() {
    let messagesContainer = this._document.getElementById("messagesContainer");
    while (messagesContainer.hasChildNodes())
      messagesContainer.removeChild(messagesContainer.lastChild);

    this.writeContent();
  },

  // FIXME: this also appears in the mail view; factor it out.
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

  rebuildSourceMenu: function() {
    let statementString = "SELECT name, id, humanURI FROM sources ORDER BY name";
    let statement = SnowlDatastore.createStatement(statementString);

    let sources = [];

    let i = 0;
    sources[i] = { id: null, name: "All" };

    try {
      // FIXME: instantiate SnowlSource objects here instead of generic objects.
      while (statement.step())
        sources[++i] = { id: statement.row.id,
                         name: statement.row.name,
                         humanURI: URI.get(statement.row.humanURI) };
    }
    finally {
      statement.reset();
    }

    let sourceMenu = document.getElementById("sourceMenu");
    sourceMenu.removeAllItems();
    for each (let source in sources) {
      let item = sourceMenu.appendItem(source.name, source.id);
      item.className = "menuitem-iconic";
      let uri = source.humanURI || URI.get("urn:use-default-icon");
      let favicon = this._faviconSvc.getFaviconImageForPage(uri);
      item.image = favicon.spec;
    }

    sourceMenu.selectedIndex = 0;
  }
};

window.addEventListener("scroll", function(evt) RiverView.onScroll(evt), false);
