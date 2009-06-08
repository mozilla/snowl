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

const EXPORTED_SYMBOLS = ["TEXT_CONSTRUCT_TYPES",
                          "INTERNET_MEDIA_TYPES",
                          "PART_TYPE_CONTENT",
                          "PART_TYPE_SUMMARY",
                          "XML_NS",
                          "XUL_NS",
                          "HTML_NS",
                          "MESSAGE_NON_CURRENT",
                          "MESSAGE_CURRENT",
                          "MESSAGE_NON_CURRENT_DELETED",
                          "MESSAGE_CURRENT_DELETED",
                          "MESSAGE_CURRENT_PENDING_PURGE"];

// Internet media type to nsIFeedTextConstruct::type mappings.
const TEXT_CONSTRUCT_TYPES = {
              "text/html": "html",
  "application/xhtml+xml": "xhtml",
             "text/plain": "text"
};

// nsIFeedTextConstruct::type to Internet media type mappings.
const INTERNET_MEDIA_TYPES = {
   html: "text/html",
  xhtml: "application/xhtml+xml",
   text: "text/plain"
};

// XXX Should this be a hash of types like TEXT_CONSTRUCT_TYPES above?
const PART_TYPE_CONTENT = 1;
const PART_TYPE_SUMMARY = 2;

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";

// Message statuses
const MESSAGE_NON_CURRENT = 0;
const MESSAGE_CURRENT = 1;
const MESSAGE_NON_CURRENT_DELETED = 2;
const MESSAGE_CURRENT_DELETED = 3;
const MESSAGE_CURRENT_PENDING_PURGE = 4;
