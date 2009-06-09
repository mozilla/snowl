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
Cu.import("resource://snowl/modules/Sync.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/utils.js");
Cu.import("resource://snowl/modules/twitter.js");
Cu.import("resource://snowl/modules/service.js");

let SnowlMessageView = {
  get _log() {
    delete this._log;
    return this._log = Log4Moz.repository.getLogger("Snowl.Stream");
  },

  get _writeButton() {
    delete this._writeButton;
    return this._writeButton = document.getElementById("writeButton");
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


  //**************************************************************************//
  // Initialization & Destruction

  onLoad: function() {
    Observers.add("snowl:message:added",    this.onMessageAdded,    this);
    Observers.add("snowl:source:added",  this.onSourcesChanged,  this);
    Observers.add("snowl:source:removed",   this.onSourceRemoved,   this);

    this.onResize();

    // Explicitly wrap |window| in an XPCNativeWrapper to make sure
    // it's a real native object! This will throw an exception if we
    // get a non-native object.
    this._window = new XPCNativeWrapper(window);
    this._document = this._window.document;

    this._collection = new SnowlCollection();

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
    this._collection.order = "messages.id DESC";

    // Show the last couple hundred messages.
    // We used to show all messages within a certain time period, like the last
    // week or the last day, but the purpose of the stream view is to let users
    // glance at recent activity as it scrolls by, not browse messages over long
    // periods of time, and a week's worth of messages is too many to usefully
    // browse in the view.  And a day's worth of messages means that if you start
    // your browser after not having used it for a day, you'll see nothing
    // in the view when you first open it, which is confusing and unexpected.
    this._collection.limit = 250;

    // Set messages to null, to trigger collection build (unlike List view).
    this._collection.invalidate();

    this._initWriteForm();
    this._updateWriteButton();

    this._rebuildView();
  },

  onunLoad: function() {
    Observers.remove("snowl:message:added",   this.onMessageAdded,    this);
    Observers.remove("snowl:source:added", this.onSourcesChanged,  this);
    Observers.remove("snowl:source:removed",  this.onSourceRemoved,   this);
  },

  _initWriteForm: function() {
    // For some reason setting hidden="true" in the XUL file prevents us
    // from showing the box later via writeForm.hidden = false, so we set it
    // here instead.
    // FIXME: file a bug on this abnormality.
    // XXX Note: setting hidden="true" and then showing the box later
    // via writeForm.hidden = false works fine in the list sidebar, so I'm
    // not sure why it isn't working here.
    this._writeForm.hidden = true;
  },

  // Selectively enable/disable the button for writing a message depending on
  // whether or not the user has an account that supports writing.
  _updateWriteButton: function() {
    this._writeButton.disabled = (SnowlService.targets.length == 0);
  },


  //**************************************************************************//
  // Event & Notification Handlers

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
    this._updateRule(0, ".body { min-width: " + width + "px; max-width: " + width + "px }");
    this._updateRule(1, ".body > div { min-width: " + width + "px; max-width: " + width + "px }");
    this._updateRule(2, ".centerColumn { min-width: " + width + "px; max-width: " + width + "px }");
  },

  onMessageAdded: function(message) {
    let messages = this._document.getElementById("contentBox");
    let messageBox = this._buildMessageView(message);
    messages.insertBefore(messageBox, messages.firstChild);
  },

  onSourcesChanged: function() {
    this._updateWriteButton();
  },

  onSourceRemoved: function() {
    // We don't currently have a way to remove just the messages
    // from the removed source, so rebuild the entire view.
    this._collection.invalidate();
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
  // Content Generation

  _rebuildView: function() {
    let begin = new Date();

    let contentBox = this._document.getElementById("contentBox");
    while (contentBox.hasChildNodes())
      contentBox.removeChild(contentBox.lastChild);

    for (let i = 0; i < this._collection.messages.length; ++i) {
      let message = this._collection.messages[i];
      let messageBox = this._buildMessageView(message);
      contentBox.appendChild(messageBox);

      // Sleep a bit after every message so we don't hork the UI thread and users
      // can immediately start reading messages while we finish writing them.
      Sync.sleep(0);
    }

    this._log.info("time spent building view: " + (new Date() - begin) + "ms\n");

    //let serializer = Cc["@mozilla.org/xmlextras/xmlserializer;1"].
    //                 createInstance(Ci.nsIDOMSerializer);
    //this._log.info(serializer.serializeToString(document.getElementById("contentBox")));
  },

  _buildMessageView: function(message) {
    let messageBox = this._document.createElementNS(XUL_NS, "hbox");
    messageBox.className = "message";

    // left column
    let leftColumn = this._document.createElementNS(XUL_NS, "vbox");
    leftColumn.className = "leftColumn";
    let icon = document.createElementNS(XUL_NS, "image");
    icon.className = "icon";
    if (message.author && message.author.person.iconURL)
      icon.setAttribute("src", message.author.person.iconURL);
    else if (message.source.faviconURI)
      icon.setAttribute("src", message.source.faviconURI.spec)
    else
      icon.setAttribute("src", "chrome://snowl/skin/livemarkItem-16.png");

    leftColumn.appendChild(icon);
    messageBox.appendChild(leftColumn);

    // center column
    let centerColumn = this._document.createElementNS(XUL_NS, "vbox");
    centerColumn.className = "centerColumn";
    messageBox.appendChild(centerColumn);

    // Author or Source
    if (message.author || message.source) {
      let desc = this._document.createElementNS(XUL_NS, "description");
      let value = message.author && message.author.person.name ?
                                    message.author.person.name :
                                    message.source.name;
      desc.className = "author";
      desc.setAttribute("crop", "end");
      desc.setAttribute("value", value);
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

    let content = message.subject || message.excerpt;

    if (message.link) {
      let a = this._document.createElementNS(HTML_NS, "a");
      SnowlUtils.safelySetURIAttribute(a, "href", message.link, message.source.principal);
      body.className += " text-link";
      a.appendChild(this._document.createTextNode(content));
      div.appendChild(a);
    }
    else if (content) {
      SnowlUtils.linkifyText(content, div, message.source.principal);
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
    //  SnowlUtils.safelySetURIAttribute(source, "href", message.source.humanURI.spec, message.source.principal);
    //centerColumn.appendChild(source);

    // right column
    let rightColumn = this._document.createElementNS(XUL_NS, "vbox");
    rightColumn.className = "rightColumn";
    messageBox.appendChild(rightColumn);

    return messageBox;
  }

};
