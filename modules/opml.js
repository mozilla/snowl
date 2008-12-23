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

// modules that are generic
Cu.import("resource://snowl/modules/StringBundle.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/service.js");

let EXPORTED_SYMBOLS = ["SnowlOPML"];

let SnowlOPML = {
  get _strings() {
    delete this._strings;
    return this._strings = new StringBundle("chrome://snowl/locale/opml.properties");
  },

  //**************************************************************************//
  // OPML Export
  // Based on code in Thunderbird's feed-subscriptions.js.

  export: function(window) {
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, this._strings.get("filePickerTitle"), Ci.nsIFilePicker.modeSave);
    fp.appendFilter(this._strings.get("opmlFilterTitle"), "*.opml");
    fp.appendFilters(Ci.nsIFilePicker.filterXML | Ci.nsIFilePicker.filterAll);
    fp.defaultString = this._strings.get("defaultFilename");
    fp.defaultExtension = "opml";

    let rv = fp.show();

    if (rv == Ci.nsIFilePicker.returnCancel)
      return;

    let doc = this._createOPMLDocument(window.document);

    // Format the document with newlines and indentation so it's easier
    // for humans to read.
    this._prettifyNode(doc.documentElement, 0);

    let serializer = Cc["@mozilla.org/xmlextras/xmlserializer;1"].
                     createInstance(Ci.nsIDOMSerializer);
    let foStream = Cc["@mozilla.org/network/file-output-stream;1"].
                   createInstance(Ci.nsIFileOutputStream);
    // default mode:  write | create | truncate
    let mode = 0x02 | 0x08 | 0x20;
    foStream.init(fp.file, mode, 0666, 0);
    serializer.serializeToStream(doc, foStream, "utf-8");
  },

  _createOPMLDocument: function(document) {
    let doc = document.implementation.createDocument("", "opml", null);
    let root = doc.documentElement;
    root.setAttribute("version", "1.0");

    // Create the <head> element.
    let head = doc.createElement("head");
    root.appendChild(head);

    let title = doc.createElement("title");
    head.appendChild(title);
    title.appendChild(doc.createTextNode(this._strings.get("documentTitle")));

    let dt = doc.createElement("dateCreated");
    head.appendChild(dt);
    dt.appendChild(doc.createTextNode((new Date()).toGMTString()));

    // Create the <body> element.
    let body = doc.createElement("body");
    root.appendChild(body);

    // Populate the <body> element with <outline> elements.
    // FIXME: export all accounts, not just sources but also targets.
    for each (let source in SnowlService.sources) {
      let outline = doc.createElement("outline");

      // XXX also set the title element per the OPML 2 spec?
      // (http://www.opml.org/spec2#subscriptionLists)

      outline.setAttribute("text",    source.name);

      // FIXME: delegate construction of the outline to the account itself,
      // so accounts can set account-specific attributes like username
      // without having to hack this code.
      if (source.constructor.name == "SnowlTwitter") {
        outline.setAttribute("type",      "twitter");
        outline.setAttribute("username",  source.username);
      }
      else {
        // XXX Should we set the |type| attribute for feeds, and should
        // we set type="atom" for Atom feeds or just type="rss" for all feeds?
        // This document says the latter but is three years old:
        // http://www.therssweblog.com/?guid=20051003145153
        // But the OPML 2 spec also suggests they should all be type="rss".
        outline.setAttribute("url",     source.humanURI.spec);
        outline.setAttribute("xmlUrl",  source.machineURI.spec);
      }

      body.appendChild(outline);
    }

    return doc;
  },

  _prettifyNode: function(node, level) {
    let doc = node.ownerDocument;

    // Create a string containing two spaces for every level deep we are.
    let indentString = new Array(level + 1).join("  ");

    // Indent the tag.
    if (level > 0)
      node.parentNode.insertBefore(doc.createTextNode(indentString), node);

    // Grab the list of nodes to format.  We can't just use node.childNodes
    // because it'd change under us as we insert formatting nodes.
    let childNodesToFormat = [];
    for (let i = 0; i < node.childNodes.length; i++)
      if (node.childNodes[i].nodeType == node.ELEMENT_NODE)
        childNodesToFormat.push(node.childNodes[i]);

    if (childNodesToFormat.length > 0) {
      for each (let childNode in childNodesToFormat)
        this._prettifyNode(childNode, level + 1);

      // Insert a newline after the opening tag.
      node.insertBefore(doc.createTextNode("\n"), node.firstChild);
  
      // Indent the closing tag.
      node.appendChild(doc.createTextNode(indentString));
    }

    // Insert a newline after the tag.
    if (level > 0) {
      if (node.nextSibling)
        node.parentNode.insertBefore(doc.createTextNode("\n"),
                                     node.nextSibling);
      else
        node.parentNode.appendChild(doc.createTextNode("\n"));
    }
  }
};
