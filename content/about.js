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

let stringBundle = document.getElementById("snowlStringBundle");

let silkIconSetName = stringBundle.getString("silkIconSetName");
let silkIconSetURL = stringBundle.getString("silkIconSetURL");
let silkIconSet = '<html:a href="" link="' + silkIconSetURL +
                  '" onclick="visitLink(event)">' + silkIconSetName +
                  '</html:a>';

let ccA25LicenseName = stringBundle.getString("ccA25LicenseName");
let ccA25LicenseURL = stringBundle.getString("ccA25LicenseURL");
let ccA25License = '<html:a href="" link="' + ccA25LicenseURL +
                   '" onclick="visitLink(event)">' + ccA25LicenseName +
                   '</html:a>';

let opmlIconProjectName = stringBundle.getString("opmlIconProjectName");
let opmlIconProjectURL = stringBundle.getString("opmlIconProjectURL");
let opmlIconProject = '<html:a href="" link="' + opmlIconProjectURL +
                      '" onclick="visitLink(event)">' + opmlIconProjectName +
                      '</html:a>';

let ccASA25LicenseName = stringBundle.getString("ccASA25LicenseName");
let ccASA25LicenseURL = stringBundle.getString("ccASA25LicenseURL");
let ccASA25License = '<html:a href="" link="' + ccASA25LicenseURL +
                     '" onclick="visitLink(event)">' + ccASA25LicenseName +
                     '</html:a>';

let attribution =
  stringBundle.getFormattedString("attribution", [silkIconSet,
                                                  ccA25License,
                                                  opmlIconProject,
                                                  ccASA25License]);

document.getElementById("attributionDiv").innerHTML = attribution;
