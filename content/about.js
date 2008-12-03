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

if (typeof Cu == "undefined")
  var Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/StringBundle.js");

let SnowlAbout = {
  HTML_NS: "http://www.w3.org/1999/xhtml",

  // From loadHomepage() behavior
  visitLink: function (aEvent) {
    window.close();
    window.opener.openURL(aEvent.target.getAttribute("link"));
  },

  // This onload follows the generic About dialog init, so that any install.rdf
  // based values are created first. We want to add links to various attributions
  // so use the methods below to append to the generic dialog in the relevant
  // structure already created.
  onLoad: function() {
    gExtensionID = window.arguments[0];
    if (gExtensionID != "urn:mozilla:item:snowl@mozilla.org")
      return;

    let strings = new StringBundle("chrome://snowl/locale/about.properties");

    // First, generate links for each of the projects and licenses we reference.
//    let babelzilla      = '<html:a href="" link="' +
//                          strings.get("babelzillaURL") +
//                          '" onclick="SnowlAbout.visitLink(event)" class="text-link">' +
//                          strings.get("babelzillaName") +
//                          '</html:a>';

    let silkIconSet     = '<html:a href="" link="' +
                          strings.get("silkIconSetURL") +
                          '" onclick="SnowlAbout.visitLink(event)" class="text-link">' +
                          strings.get("silkIconSetName") +
                          '</html:a>';

    let ccA25License    = '<html:a href="" link="' +
                          strings.get("ccA25LicenseURL") +
                          '" onclick="SnowlAbout.visitLink(event)" class="text-link">' +
                          strings.get("ccA25LicenseName") +
                          '</html:a>';

    let opmlIconProject = '<html:a href="" link="' +
                          strings.get("opmlIconProjectURL") +
                          '" onclick="SnowlAbout.visitLink(event)" class="text-link">' +
                          strings.get("opmlIconProjectName") +
                          '</html:a>';

    let ccASA25License  = '<html:a href="" link="' +
                          strings.get("ccASA25LicenseURL") +
                          '" onclick="SnowlAbout.visitLink(event)" class="text-link">' +
                          strings.get("ccASA25LicenseName") +
                          '</html:a>';

    // Translators:
//    let tBox = document.getElementById("translatorsBox");
//    tBox.appendChild(document.createElementNS(this.HTML_NS, "html:div"));
//    tBox.lastChild.innerHTML = strings.get("translators1", [babelzilla]);
//    document.getElementById("extensionTranslators").removeAttribute("hidden");

    // Contributors:
    let cBox = document.getElementById("contributorsBox");
    cBox.appendChild(document.createElementNS(this.HTML_NS, "html:div"));
    cBox.lastChild.innerHTML = strings.get("contributors1",
        [silkIconSet, ccA25License, opmlIconProject, ccASA25License]);
//    cBox.appendChild(document.createElementNS(this.HTML_NS, "html:div"));
//    cBox.lastChild.innerHTML = strings.get("contributors2", [opmlIconProject, ccASA25License]);
    document.getElementById("extensionContributors").removeAttribute("hidden");
  }
}
