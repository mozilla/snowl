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
 * Portions created by the Initial Developer are Copyright (C) 2009
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

let EXPORTED_SYMBOLS = ["Mixins"];

/**
 * Mix attributes (properties, methods, getters/setters) from the source object
 * into the target object.
 *
 * Note: doesn't mix in attributes that already exist in the target object
 * (i.e. doesn't override existing attributes).
 * ??? Should it?
 * 
 * FIXME: give the target object access in some way to the source's version
 * of attributes it overrides.
 *
 * @param   source  {Object}  the object that provides attributes
 * @param   target  {Object}  the object that receives attributes
 */
function mixin(source, target) {
  for (let attribute in source) {
    // Don't mix in attributes that already exist in the target.
    if (attribute in target)
      continue;

    let getter = source.__lookupGetter__(attribute);
    let setter = source.__lookupSetter__(attribute);

    // We can have a getter, a setter, or both.  If we have either, we only
    // define one or both of them.  Otherwise, we assign the property directly.
    if (getter || setter) {
      if (getter)
        target.__defineGetter__(attribute, getter);
      if (setter)
        target.__defineSetter__(attribute, setter);
    }
    else
       target[attribute] = source[attribute];
  }
}

// FIXME: support both source and target arguments accepting arrays of objects.
let Mixins = {
  mix: function(source) {
    return {
      source: source,
      into: function(target) {
        mixin(this.source, target);
      }
    };
  }
};
