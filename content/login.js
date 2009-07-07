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

let source = window.arguments[0].wrappedJSObject;
let authInfo = window.arguments[1].QueryInterface(Ci.nsIAuthInformation);
let result = window.arguments[2].wrappedJSObject;

function doOnLoad() {
  let stringBundle = document.getElementById("snowlStringBundle");

  let prompt;
  let sourceURL = (source.humanURI || source.machineURI).spec;
  if (source.name)
    prompt = stringBundle.getFormattedString("namedSourcePrompt", [source.name, sourceURL]);
  else
    prompt = stringBundle.getFormattedString("namelessSourcePrompt", [sourceURL]);
  document.getElementById("prompt").appendChild(document.createTextNode(prompt));

  document.getElementById("realm").value = authInfo.realm;

  document.getElementById("username").value = source.username || authInfo.username;
  document.getElementById("password").value = authInfo.password;

  if (source.username) {
    document.getElementById("username").readOnly = true;
    document.getElementById("password").focus();
  }

  // FIXME: handle authInfo.flags (i.e. don't prompt for username if it's
  // already available, and prompt for domain if necessary).
}

function doShowPassword() {
  if (document.getElementById("showPassword").checked)
    document.getElementById("password").removeAttribute("type");
  else
    document.getElementById("password").setAttribute("type", "password");
}

function doOK() {
  // FIXME: validate input.
  result.proceed = true;
  result.remember = document.getElementById("rememberPassword").checked;
  authInfo.username = document.getElementById("username").value;
  authInfo.password = document.getElementById("password").value;
  return true;
}

function doCancel() {
  result.proceed = false;
  return true;
}
