/*!
 * angular-ui-mask
 * https://github.com/angular-ui/ui-mask
 * Version: 1.8.6 - 2016-06-20T21:05:48.730Z
 * License: MIT
 */

(function () {
    'use strict';
    /*
     Attaches input mask onto input element
     */

    //var dl = new DebugLog();

    var maskDefaultConfig = {
        maskDefinitions: {
            '9': /\d/,
            'A': /[a-zA-Z]/,
            '*': /[a-zA-Z0-9]/
        },
        clearOnBlur: true,
        clearOnBlurPlaceholder: false,
        escChar: '\\',
        eventsToHandle: ['input', 'keyup', 'click', 'focus'],
        addDefaultPlaceholder: true,
        allowInvalidValue: false
    };

    angular
        .module('ui.mask', [])
        .value('uiMaskConfig', maskDefaultConfig)
        .provider('uiMask.Config', maskConfigProvider)
        .directive('uiMask', ['uiMask.Config', uiMask]);

    function uiMask(maskConfig) {
        var options = angular.copy(maskConfig);

        return {
            priority: 100,
            require: 'ngModel',
            restrict: 'A',
            compile: function uiMaskCompilingFunction() {
                return uiMaskLinkingFunction;
            }
        };

        function uiMaskLinkingFunction(scope, iElement, iAttrs, controller) {
            var maskProcessed = false, eventsBound = false,
                    maskCaretMap, maskPatterns, maskPlaceholder, maskComponents, mask,
                    // Minimum required length of the value to be considered valid
                    minRequiredLength,
                    value, valueMasked, isValid,
                    // Vars for initializing/uninitializing
                    originalPlaceholder = iAttrs.placeholder,
                    originalMaxlength = iAttrs.maxlength,
                    // Vars used exclusively in eventHandler()
                    oldValue, oldValueUnmasked, oldCaretPosition, oldSelectionLength,
                    // Used for communicating if a backspace operation should be allowed between
                    // keydownHandler and eventHandler
                    preventBackspace;

            var originalIsEmpty = controller.$isEmpty;
            controller.$isEmpty = $isEmpty;

            var modelViewValue = false;
            iAttrs.$observe('modelViewValue', function (val) {
                if (val === 'true') {
                    modelViewValue = true;
                }
            });

            var linkOptions = {};

            iAttrs.$observe('allowInvalidValue', function (val) {
                linkOptions.allowInvalidValue = val === '' ? true : !!val;
                formatter(controller.$modelValue);
            });

            if (iAttrs.uiOptions) {
                linkOptions = scope.$eval('[' + iAttrs.uiOptions + ']');
                if (angular.isObject(linkOptions[0])) {
                    // we can't use angular.copy nor angular.extend, they lack the power to do a deep merge
                    linkOptions = (function (original, current) {
                        for (var i in original) {
                            if (Object.prototype.hasOwnProperty.call(original, i)) {
                                if (current[i] === undefined) {
                                    current[i] = angular.copy(original[i]);
                                } else {
                                    if (angular.isObject(current[i]) && !angular.isArray(current[i])) {
                                        current[i] = angular.extend({}, original[i], current[i]);
                                    }
                                }
                            }
                        }
                        return current;
                    })(options, linkOptions[0]);
                } else {
                    linkOptions = options;  //gotta be a better way to do this..
                }
            } else {
                linkOptions = options;
            }

            iAttrs.$observe('uiMask', initialize);

            if (angular.isDefined(iAttrs.uiMaskPlaceholder)) {
                iAttrs.$observe('uiMaskPlaceholder', initPlaceholder);
            }
            else {
                iAttrs.$observe('placeholder', initPlaceholder);
            }
            if (angular.isDefined(iAttrs.uiMaskPlaceholderChar)) {
                iAttrs.$observe('uiMaskPlaceholderChar', initPlaceholderChar);
            }

            controller.$formatters.unshift(formatter);
            controller.$parsers.unshift(parser);

            function $isEmpty(value) {
                // LOG_FUNCTION $isEmpty
                // dl.logFunction($isEmpty);

                // LOG value
                // dl.log('value', value);

                value = maskProcessed ? unmaskValue(value) : value;
                var result = originalIsEmpty(value);

                // GOL result
                // dl.endLog(result);
                return result;
            }

            function initialize(maskAttr) {
                if (!angular.isDefined(maskAttr)) {
                    return uninitialize();
                }
                processRawMask(maskAttr);
                if (!maskProcessed) {
                    return uninitialize();
                }
                initializeElement();
                bindEventListeners();
                return true;
            }

            function initPlaceholder(placeholderAttr) {
                // LOG_FUNCTION initPlaceholder
                // dl.logFunction(initPlaceholder);

                // LOG placeholderAttr
                // dl.log('placeholderAttr', placeholderAttr);

                if (!placeholderAttr) {
                    // GOL
                    // dl.endLog();
                    return;
                }

                maskPlaceholder = placeholderAttr;

                // If the mask is processed, then we need to update the value
                // but don't set the value if there is nothing entered into the element
                // and there is a placeholder attribute on the element because that
                // will only set the value as the blank maskPlaceholder
                // and override the placeholder on the element
                if (maskProcessed && !(iElement.val().length === 0 && angular.isDefined(iAttrs.placeholder))) {
                    iElement.val(maskValue(unmaskValue(iElement.val())));
                }

                // GOL
                // dl.endLog();
            }

            function initPlaceholderChar() {
                return initialize(iAttrs.uiMask);
            }

            function formatter(fromModelValue) {
                // LOG_FUNCTION formatter
                // dl.logFunction(formatter);

                // LOG fromModelValue
                // dl.log('fromModelValue', fromModelValue);

                if (!maskProcessed) {
                    // GOL fromModelValue
                    // dl.endLog(fromModelValue);
                    return fromModelValue;
                }

                value = unmaskValue(fromModelValue);
                isValid = validateValue(value);
                controller.$setValidity('mask', isValid);

                if (!value.length) {
                    // GOL
                    // dl.endLog();
                    return;
                }

                if (isValid || linkOptions.allowInvalidValue) {
                    var result = maskValue(value);
                    // GOL result
                    // dl.endLog(result);
                    return result;
                } else {
                    // GOL
                    // dl.endLog();
                    return;
                }
            }

            function parser(fromViewValue) {
                // LOG_FUNCTION parser
                // dl.logFunction(parser);

                // LOG fromViewValue
                // dl.log('fromViewValue', fromViewValue);

                if (!maskProcessed) {
                    // GOL fromViewValue
                    // dl.endLog(fromViewValue);
                    return fromViewValue;
                }

                value = unmaskValue(fromViewValue);
                isValid = validateValue(value);
                // We have to set viewValue manually as the reformatting of the input
                // value performed by eventHandler() doesn't happen until after
                // this parser is called, which causes what the user sees in the input
                // to be out-of-sync with what the controller's $viewValue is set to.
                controller.$viewValue = value.length ? maskValue(value) : '';
                controller.$setValidity('mask', isValid);

                if (isValid || linkOptions.allowInvalidValue) {
                    var result = modelViewValue ? controller.$viewValue : value;
                    // GOL result
                    // dl.endLog(result);
                    return result;
                }
            }

            function uninitialize() {
                maskProcessed = false;
                unbindEventListeners();

                if (angular.isDefined(originalPlaceholder)) {
                    iElement.attr('placeholder', originalPlaceholder);
                } else {
                    iElement.removeAttr('placeholder');
                }

                if (angular.isDefined(originalMaxlength)) {
                    iElement.attr('maxlength', originalMaxlength);
                } else {
                    iElement.removeAttr('maxlength');
                }

                iElement.val(controller.$modelValue);
                controller.$viewValue = controller.$modelValue;
                return false;
            }

            function initializeElement() {
                // LOG_FUNCTION initializeElement
                // dl.logFunction(initializeElement);

                value = oldValueUnmasked = unmaskValue(controller.$modelValue);
                valueMasked = oldValue = maskValue(value);
                isValid = validateValue(value);
                if (iAttrs.maxlength) { // Double maxlength to allow pasting new val at end of mask
                    iElement.attr('maxlength', maskCaretMap[maskCaretMap.length - 1] * 2);
                }
                if (!originalPlaceholder && linkOptions.addDefaultPlaceholder) {
                    iElement.attr('placeholder', maskPlaceholder);
                }
                var viewValue = controller.$modelValue;
                var idx = controller.$formatters.length;
                while (idx--) {
                    viewValue = controller.$formatters[idx](viewValue);
                }
                controller.$viewValue = viewValue || '';
                controller.$render();
                // Not using $setViewValue so we don't clobber the model value and dirty the form
                // without any kind of user interaction.
                // GOL
                // dl.endLog();
            }

            function bindEventListeners() {
                if (eventsBound) {
                    return;
                }
                iElement.bind('blur', blurHandler);
                iElement.bind('mousedown mouseup', mouseDownUpHandler);
                iElement.bind('keydown', keydownHandler);
                iElement.bind(linkOptions.eventsToHandle.join(' '), eventHandler);
                eventsBound = true;
            }

            function unbindEventListeners() {
                if (!eventsBound) {
                    return;
                }
                iElement.unbind('blur', blurHandler);
                iElement.unbind('mousedown', mouseDownUpHandler);
                iElement.unbind('mouseup', mouseDownUpHandler);
                iElement.unbind('keydown', keydownHandler);
                iElement.unbind('input', eventHandler);
                iElement.unbind('keyup', eventHandler);
                iElement.unbind('click', eventHandler);
                iElement.unbind('focus', eventHandler);
                eventsBound = false;
            }

            function validateValue(value) {
                // Zero-length value validity is ngRequired's determination
                // LOG_FUNCTION validateValue
                // dl.logFunction(validateValue);

                // LOG value
                // dl.log('value', value);

                var valueLength = value.length;
                // dl.log('valueLength', valueLength);

                var result = valueLength ? valueLength >= minRequiredLength : true;
                // GOL result
                // dl.endLog(result);
                return result;
            }

            function isMaskSymbolAtPosition(maskComponents, position) {
                return maskComponents.some(function (component) {
                    var position = component.position - position;
                    return 0 <= position && position < component.length;
                });
            }

            function unmaskValue(value) {
                // LOG_FUNCTION unmaskValue
                // dl.logFunction(unmaskValue);

                // LOG value
                value = value || '';
                value = value.toString();
                // dl.log('value', value);

                var valueLength = value.length;
                // dl.log('valueLength', valueLength);

                // dl.log('oldValue', oldValue);

                var oldValueLength = (oldValue || '').length;
                // dl.log('oldValueLength', oldValueLength);
                // dl.log('oldValueUnmasked', oldValueUnmasked);

                var valueDelta = valueLength - oldValueLength;
                // dl.log('valueDelta', valueDelta);

                var selectionStart = 0;
                var selectionEnd = valueLength;

                while (selectionStart < selectionEnd) {
                    if (value[selectionStart] !== (oldValue && oldValue[selectionStart])) {
                        break;
                    }

                    selectionStart += 1;
                }

                while (valueLength - selectionEnd < oldValueLength - selectionStart) {
                    selectionEnd -= 1;

                    if (value[selectionEnd] !== (oldValue && oldValue[selectionEnd - valueDelta])) {
                        selectionEnd += 1;
                        break;
                    }
                }

                // dl.log('selectionStart', selectionStart);
                // dl.log('selectionEnd', selectionEnd);
                // dl.log('maskPatterns', maskPatterns);

                var result = '';
                var maskCharPos = 0;
                var valueChars = value.split('');
                var valueCharsLength = valueChars.length;
                //var insertationEnd = 0;
                
                for (var index = 0; index < valueCharsLength; index += 1) {
                    var valueChar = value[index];
                    // LOG_CYCLE 'mask patterns' INDEX chr
                    // dl.logCycle('value chars', valueChar);
                    // dl.log('index', index);

                    if (result.length === maskPatterns.length) {
                        break;
                    }

                    var isOldChar = index < selectionStart || selectionEnd <= index;

                    if (isOldChar) {
                        // dl.log('is old char');

                        var oldCharIndex = index < selectionStart ? index : index - valueDelta;
                        var isOldValueChar = !angular.isString(mask[oldCharIndex]);

                        if (isOldValueChar) {
                            // dl.log('is old value char');

                            considerValueCharAsNearestValuePattern();
                        }

                        // dl.endLog();
                        continue;
                    }

                    // dl.log('newly inserted char');

                    //var allowNewSymbol = mask.length - index < valueLength - selectionEnd;

                    var maskChar = mask[maskCharPos];
                    // dl.log('maskChar', maskChar);

                    var isValueChar = !angular.isString(maskChar);

                    if (isValueChar) {
                        // dl.log('expect value char');

                        if (!maskChar.test(valueChar)) {
                            // dl.log('is invalid value char');

                            // dl.endLog();
                            continue;
                        }

                        // dl.log('is valid value char');

                        // prevent new symbols override existed symbols
                        result += valueChar;
                        // dl.log('result', result);

                        maskCharPos += 1;
                        // dl.log('maskCharPos', maskCharPos);

                        //if (insertationEnd < result.length) {
                        //    insertationEnd = result.length;
                        //}

                        // dl.endLog();
                        continue;
                    }

                    // dl.log('expect mask char');

                    if (valueChar !== maskChar) {
                        // dl.log('not equal to mask char');

                        if (!considerValueCharAsNearestValuePattern()) {
                            index -= 1;
                            // dl.log('try to compare same char with next mask char');

                            maskCharPos += 1;
                            // dl.log('maskCharPos', maskCharPos);
                        }

                        // GOL
                        // dl.endLog();
                        continue;
                    }

                    // dl.log('mask char detected');

                    maskCharPos += 1;
                    // dl.log('maskCharPos', maskCharPos);

                    // dl.endLog();
                }

                //if (maskPatterns.length < result.length) {
                //    var maskIncrease = result.length - maskPatterns.length;
                //    result = result.substring(0, insertationEnd - maskIncrease) + result.substring(insertationEnd + 1);
                //}

                // dl.endLog(result);
                return result;

                function considerValueCharAsNearestValuePattern() {
                    var nearestValuePattern = maskPatterns[result.length];
                    if (!nearestValuePattern.test(valueChar)) {
                        // dl.log('current value char not equal to nearest mask pattern');
                        return;
                    }

                    // prevent new symbols override existed symbols
                    // dl.log('current value char equal to nearest mask pattern');
                    result += valueChar;
                    // dl.log('result', result);

                    maskCharPos = maskCaretMap[result.length];
                    // dl.log('maskCharPos', maskCharPos);

                    return true;
                }
            }

            function maskValue(unmaskedValue) {
                // LOG_FUNCTION maskValue
                // dl.logFunction(maskValue);

                // LOG unmaskedValue
                // dl.log('unmaskedValue', unmaskedValue);

                var valueMasked = '',
                        maskCaretMapCopy = maskCaretMap.slice();

                // dl.log('maskCaretMapCopy', maskCaretMapCopy);

                angular.forEach(maskPlaceholder.split(''), function (chr, i) {
                    // LOG_CYCLE 'mask placeholder' INDEX chr, i
                    // dl.logCycle('mask placeholder', chr);

                    // dl.log('i', i);

                    var caretPos = maskCaretMapCopy[0];
                    // dl.log('caretPos', caretPos);

                    var samePos = caretPos === i;
                    // dl.log('samePos', samePos);

                    if (unmaskedValue.length && samePos) {
                        // dl.log('same position');

                        var unmaskedFirstChar = unmaskedValue.charAt(0);
                        // dl.log('unmaskedFirstChar', unmaskedFirstChar);

                        valueMasked += unmaskedFirstChar || '_';
                        // dl.log('valueMasked', valueMasked);

                        unmaskedValue = unmaskedValue.substr(1);
                        // dl.log('unmaskedValue', unmaskedValue);

                        maskCaretMapCopy.shift();
                        // dl.log('maskCaretMapCopy', maskCaretMapCopy);
                    } else {
                        // dl.log('other position');

                        valueMasked += chr;
                        // dl.log('valueMasked', valueMasked);
                    }

                    // GOL
                    // dl.endLog();
                });

                // GOL
                // dl.endLog(valueMasked);
                return valueMasked;
            }

            function getPlaceholderChar(i) {
                // LOG_FUNCTION getPlaceholderChar
                // dl.logFunction(getPlaceholderChar);

                // LOG i
                // dl.log('i', i);

                var maskPlaceholder = iAttrs.uiMaskPlaceholder;
                // dl.log('maskPlaceholder', maskPlaceholder);

                var placeholder = angular.isDefined(maskPlaceholder) ? maskPlaceholder : iAttrs.placeholder,
                    defaultPlaceholderChar;
                // dl.log('placeholder', placeholder);

                var isDefinedPlaceholder = angular.isDefined(placeholder);
                // dl.log('isDefinedPlaceholder', isDefinedPlaceholder);

                var placeholderChar = placeholder && placeholder[i];
                // dl.log('placeholderChar', placeholderChar);

                if (isDefinedPlaceholder && placeholderChar) {
                    // dl.log('defined placeholder char');

                    // GOL placeholderChar
                    // dl.endLog(placeholderChar);
                    return placeholderChar;
                } else {
                    // dl.log('undefined or not found char');

                    var maskPlaceholderChar = iAttrs.uiMaskPlaceholderChar;
                    // dl.log('maskPlaceholderChar', maskPlaceholderChar);

                    var isDefinedChar = angular.isDefined(maskPlaceholderChar);
                    // dl.log('isDefinedChar', isDefinedChar);

                    defaultPlaceholderChar = isDefinedChar && maskPlaceholderChar ? maskPlaceholderChar : '_';
                    // dl.log('defaultPlaceholderChar', defaultPlaceholderChar);

                    var isSpaceChar = defaultPlaceholderChar.toLowerCase() === 'space';
                    // dl.log('isSpaceChar', isSpaceChar);

                    var result = isSpaceChar ? ' ' : defaultPlaceholderChar[0];
                    // GOL result
                    // dl.endLog(result);
                    return result;
                }
            }

            // Generate array of mask components that will be stripped from a masked value
            // before processing to prevent mask components from being added to the unmasked value.
            // E.g., a mask pattern of '+7 9999' won't have the 7 bleed into the unmasked value.
            function getMaskComponents() {
                var maskPlaceholderChars = maskPlaceholder.split(''),
                        maskPlaceholderCopy, components;

                //maskCaretMap can have bad values if the input has the ui-mask attribute implemented as an obversable property, e.g. the demo page
                var isNumber = !isNaN(maskCaretMap[0]);

                if (maskCaretMap && isNumber) {
                    //Instead of trying to manipulate the RegEx based on the placeholder characters
                    //we can simply replace the placeholder characters based on the already built
                    //maskCaretMap to underscores and leave the original working RegEx to get the proper
                    //mask components
                    angular.forEach(maskCaretMap, function (value) {
                        maskPlaceholderChars[value] = '_';
                    });
                }

                maskPlaceholderCopy = maskPlaceholderChars.join('');
                components = maskPlaceholderCopy.replace(/[_]+/g, '_').split('_');
                components = components.filter(function (s) {
                    return s !== '';
                });

                // need a string search offset in cases where the mask contains multiple identical components
                // E.g., a mask of 99.99.99-999.99
                var offset = 0;
                var result = components.map(function (c) {
                    var componentPosition = maskPlaceholderCopy.indexOf(c, offset);
                    offset = componentPosition + 1;
                    return {
                        value: c,
                        length: c.length,
                        position: componentPosition
                    };
                });

                return result;
            }

            function processRawMask(rawMask) {
                // LOG_FUNCTION processRawMask
                // dl.logFunction(processRawMask);

                // LOG mask
                // dl.log('rawMask', rawMask);

                var characterCount = 0;

                maskCaretMap = [];
                maskPatterns = [];
                mask = [];

                maskPlaceholder = '';

                if (angular.isString(rawMask)) {
                    minRequiredLength = 0;

                    var isOptional = false,
                            numberOfOptionalCharacters = 0,
                            splitMask = rawMask.split('');

                    var inEscape = false;
                    angular.forEach(splitMask, function (chr, i) {
                        if (inEscape) {
                            inEscape = false;
                            maskPlaceholder += chr;
                            mask.push(chr);
                            characterCount++;
                        } else if (linkOptions.escChar === chr) {
                            inEscape = true;
                        } else if (linkOptions.maskDefinitions[chr]) {
                            maskCaretMap.push(characterCount);

                            maskPlaceholder += getPlaceholderChar(i - numberOfOptionalCharacters);
                            maskPatterns.push(linkOptions.maskDefinitions[chr]);
                            mask.push(linkOptions.maskDefinitions[chr]);

                            characterCount++;
                            if (!isOptional) {
                                minRequiredLength++;
                            }

                            isOptional = false;
                        }
                        else if (chr === '?') {
                            isOptional = true;
                            numberOfOptionalCharacters++;
                        }
                        else {
                            maskPlaceholder += chr;
                            mask.push(chr);
                            characterCount++;
                        }
                    });
                }

                // dl.log('minRequiredLength', minRequiredLength);

                // Caret position immediately following last position is valid.
                maskCaretMap.push(maskCaretMap[maskCaretMap.length - 1] + 1);
                // dl.log('maskCaretMap', maskCaretMap);

                maskComponents = getMaskComponents();
                // LOG maskComponents
                // dl.log('maskComponents', maskComponents);

                maskProcessed = maskCaretMap.length > 1;

                // GOL
                // dl.endLog();
            }

            var prevValue = iElement.val();
            function blurHandler() {
                // LOG_FUNCTION blurHandler
                // dl.logFunction(blurHandler);

                var emptyValue = value.length === 0;
                // dl.log('emptyValue', emptyValue);

                var clearOnBlurOn = linkOptions.clearOnBlur;
                // dl.log('clearOnBlurOn', clearOnBlurOn);

                var clearOnBlurPlaceholderOn = linkOptions.clearOnBlurPlaceholder;
                // dl.log('clearOnBlurPlaceholderOn', clearOnBlurPlaceholderOn);

                var showOnBlurPlaceholder = clearOnBlurPlaceholderOn && emptyValue && iAttrs.placeholder;
                // dl.log('showOnBlurPlaceholder', showOnBlurPlaceholder);

                if (clearOnBlurOn || showOnBlurPlaceholder) {
                    // dl.log('clear on blur');

                    oldCaretPosition = 0;
                    oldSelectionLength = 0;
                    // dl.log('oldSelectionLength', oldSelectionLength);

                    if (!isValid || emptyValue) {
                        // dl.log('unvalid or empty value')

                        valueMasked = '';

                        iElement.val('');

                        scope.$apply(function () {
                            //only $setViewValue when not $pristine to avoid changing $pristine state.
                            if (!controller.$pristine) {
                                controller.$setViewValue('');
                            }
                        });
                    }
                }
                //Check for different value and trigger change.
                //Check for different value and trigger change.
                if (value !== prevValue) {
                    // dl.log('value was changed');

                    // #157 Fix the bug from the trigger when backspacing exactly on the first letter (emptying the field)
                    // and then blurring out.
                    // Angular uses html element and calls setViewValue(element.value.trim()), setting it to the trimmed mask
                    // when it should be empty
                    var currentVal = iElement.val();
                    // dl.log('currentVal', currentVal);

                    var valueEmpty = value === '';
                    // dl.log('valueEmpty', valueEmpty);

                    var maskPlaceholderChar = iAttrs.uiMaskPlaceholderChar;
                    // dl.log('maskPlaceholderChar', maskPlaceholderChar);

                    var isMaskPlaceholderSpaceChar = angular.isDefined(iAttrs.uiMaskPlaceholderChar) && iAttrs.uiMaskPlaceholderChar === 'space';
                    // dl.log('isMaskPlaceholderSpaceChar', isMaskPlaceholderSpaceChar);

                    var isTemporarilyEmpty = valueEmpty && currentVal && isMaskPlaceholderSpaceChar;

                    if (isTemporarilyEmpty) {
                        // dl.log('temporarily empty');
                        iElement.val('');
                    }

                    triggerChangeEvent(iElement[0]);

                    if (isTemporarilyEmpty) {
                        // dl.log('temporarily empty');
                        iElement.val(currentVal);
                    }
                }

                prevValue = value;
                // dl.log('prevValue', prevValue);

                // GOL
                // dl.endLog();
            }

            function triggerChangeEvent(element) {
                var change;
                if (angular.isFunction(window.Event) && !element.fireEvent) {
                    // modern browsers and Edge
                    change = new Event('change', {
                        view: window,
                        bubbles: true,
                        cancelable: false
                    });
                    element.dispatchEvent(change);
                } else if ('createEvent' in document) {
                    // older browsers
                    change = document.createEvent('HTMLEvents');
                    change.initEvent('change', false, true);
                    element.dispatchEvent(change);
                }
                else if (element.fireEvent) {
                    // IE <= 11
                    element.fireEvent('onchange');
                }
            }

            function mouseDownUpHandler(e) {
                var isMouseDownEvent = e.type === 'mousedown';

                if (isMouseDownEvent) {
                    iElement.bind('mouseout', mouseoutHandler);
                } else {
                    iElement.unbind('mouseout', mouseoutHandler);
                }
            }

            iElement.bind('mousedown mouseup', mouseDownUpHandler);

            function mouseoutHandler() {
                // LOG_FUNCTION mouseoutHandler
                // dl.logFunction(mouseoutHandler);

                /*jshint validthis: true */
                oldSelectionLength = getSelectionLength(this);
                // dl.log('oldSelectionLength', oldSelectionLength);

                iElement.unbind('mouseout', mouseoutHandler);

                // GOL
                // dl.endLog();
            }

            function keydownHandler(e) {
                // LOG_FUNCTION keydownHandler
                // dl.logFunction(keydownHandler);

                /*jshint validthis: true */
                var isKeyBackspace = e.which === 8,
                    caretPos = getCaretPosition(this) - 1; //value in keydown is pre change so bump caret position back to simulate post change
                // dl.log('isKeyBackspace', isKeyBackspace);
                // dl.log('caretPos', caretPos);

                if (!isKeyBackspace) {
                    // dl.log('this isn\'t backspace');
                    // GOL
                    // dl.endLog();
                    return;
                }

                // dl.log('this is backspace');

                // FIXED: for selected symbol(s) turn backspace key into delete
                if (getSelectionLength(this)) {
                    // dl.log('ignore backspace for selected range');
                    // GOL
                    // dl.endLog();
                    return;
                }

                var maskFirstCaret = maskCaretMap[0];
                if (caretPos < maskFirstCaret) {
                    // GOL
                    // dl.endLog();
                    return;
                }

                while (caretPos >= 0) {
                    // LOG_CYCLE 'poitive caret positions' INDEX caretPos
                    // dl.logCycle('positive caret positions', caretPos);

                    if (isValidCaretPosition(caretPos)) {
                        // LOG 'valid caret position'
                        // dl.log('valid caret position');

                        //re-adjust the caret position.
                        //Increment to account for the initial decrement to simulate post change caret position
                        setCaretPosition(this, caretPos + 1);

                        // GOL
                        // dl.endLog();
                        break;
                    }

                    caretPos--;
                    // dl.log('caretPos', caretPos);

                    // GOL
                    // dl.endLog();
                }

                preventBackspace = caretPos === -1;
                // dl.log('preventBackspace', preventBackspace);

                // GOL
                // dl.endLog();
            }

            function eventHandler(e) {
                // LOG_FUNCTION eventHandler
                // dl.logFunction(eventHandler);

                /*jshint validthis: true */
                e = e || {};
                // Allows more efficient minification
                var eventWhich = e.which,
                        eventType = e.type;

                // dl.log('eventWhich', eventWhich);
                // dl.log('eventType', eventType);

                // Prevent shift and ctrl from mucking with old values
                var isShiftKey = eventWhich === 16;

                var isCtrlKey = eventWhich === 91;

                if (isShiftKey || isCtrlKey) {
                    // dl.endLog();
                    return;
                }

                var val = iElement.val(),
                        valOld = oldValue,
                        valMasked,
                        valAltered = false,
                        valUnmasked = unmaskValue(val),
                        valUnmaskedOld = oldValueUnmasked,
                        caretPos = getCaretPosition(this);

                // dl.log('val', val);
                // dl.log('valOld', valOld);
                // dl.log('valUnmasked', valUnmasked);
                // dl.log('valUnmaskedOld', valUnmaskedOld);
                // dl.log('caretPos', caretPos);

                var isValueStartsWithOldValue = val.indexOf(valOld) === 0;
                // dl.log('isValueStartsWithOldValue', isValueStartsWithOldValue);

                var valueLength = val.length;
                // dl.log('valueLength', valueLength);

                var oldValueLength = valOld.length;
                // dl.log('oldValueLength', oldValueLength);

                if (isValueStartsWithOldValue) {
                    // dl.log('value and old value has same origin');

                    caretPos += valueLength - oldValueLength;
                    // dl.log('caretPos', caretPos);
                }

                var valUnmaskedLength = valUnmasked.length;
                // dl.log('valUnmaskedLength', valUnmaskedLength);

                var maskLastCaret = maskCaretMap[maskCaretMap.length - 1];
                // dl.log('maskLastCaret', maskLastCaret);

                // FIXED: if maskCaret greater then available. then choose last available
                var maskCaret = maskCaretMap[valUnmaskedLength] || maskLastCaret;
                // dl.log('maskCaret', maskCaret);

                var maskFirstCaret = maskCaretMap[0];
                // dl.log('maskFirstCaret', maskFirstCaret);

                var caretPosOld = oldCaretPosition || 0,
                        caretPosDelta = caretPos - caretPosOld,
                        caretPosMin = maskFirstCaret,
                        caretPosMax = maskCaret || maskFirstCaret,
                        selectionLenOld = oldSelectionLength || 0,
                        isSelected = getSelectionLength(this) > 0,
                        wasSelected = selectionLenOld > 0,
                        // Case: Typing a character to overwrite a selection
                        isAddition = (valueLength > oldValueLength) || (selectionLenOld && valueLength > oldValueLength - selectionLenOld),
                        // Case: Delete and backspace behave identically on a selection
                        isDeletion = (valueLength < oldValueLength) || (selectionLenOld && valueLength === oldValueLength - selectionLenOld),
                        isSelection = (eventWhich >= 37 && eventWhich <= 40) && e.shiftKey, // Arrow key codes

                        isKeyLeftArrow = eventWhich === 37,
                        // Necessary due to "input" event not providing a key code
                        isKeyBackspace = eventWhich === 8 || (eventType !== 'keyup' && isDeletion && (caretPosDelta === -1)),
                        isKeyDelete = eventWhich === 46 || (eventType !== 'keyup' && isDeletion && (caretPosDelta === 0) && !wasSelected),
                        // Handles cases where caret is moved and placed in front of invalid maskCaretMap position. Logic below
                        // ensures that, on click or leftward caret placement, caret is moved leftward until directly right of
                        // non-mask character. Also applied to click since users are (arguably) more likely to backspace
                        // a character when clicking within a filled input.
                        caretBumpBack = (isKeyLeftArrow || isKeyBackspace || eventType === 'click') && caretPos > caretPosMin;

                // dl.log('caretPosOld', caretPosOld);
                // dl.log('caretPosDelta', caretPosDelta);
                // dl.log('caretPosMin', caretPosMin);
                // dl.log('caretPosMax', caretPosMax);
                // dl.log('selectionLenOld', selectionLenOld);
                // dl.log('isSelected', isSelected);
                // dl.log('wasSelected', wasSelected);
                // dl.log('isAddition', isAddition);
                // dl.log('isDeletion', isDeletion);
                // dl.log('isSelection', isSelection);
                // dl.log('isKeyLeftArrow', isKeyLeftArrow);
                // dl.log('isKeyBackspace', isKeyBackspace);
                // dl.log('isKeyDelete', isKeyDelete);
                // dl.log('caretBumpBack', caretBumpBack);

                oldSelectionLength = getSelectionLength(this);
                // dl.log('oldSelectionLength', oldSelectionLength);

                // These events don't require any action
                if (isSelection || (isSelected && (eventType === 'click' || eventType === 'keyup' || eventType === 'focus'))) {
                    // dl.log('event without action');
                    // GOL
                    // dl.endLog();
                    return;
                }

                if (isKeyBackspace && preventBackspace) {
                    // dl.log('prevent backspace');

                    iElement.val(maskPlaceholder);
                    // This shouldn't be needed but for some reason after aggressive backspacing the controller $viewValue is incorrect.
                    // This keeps the $viewValue updated and correct.
                    scope.$apply(function () {
                        controller.$setViewValue(''); // $setViewValue should be run in angular context, otherwise the changes will be invisible to angular and user code.
                    });

                    setCaretPosition(this, caretPosOld);

                    // GOL
                    // dl.endLog();
                    return;
                }

                // Value Handling
                // ==============

                // User attempted to delete but raw value was unaffected--correct this grievous offense
                if ((eventType === 'input') && isDeletion && !wasSelected && valUnmasked === valUnmaskedOld) {
                    // dl.log('input deletion was not selected equal to old mask');

                    while (isKeyBackspace && caretPos > caretPosMin && !isValidCaretPosition(caretPos)) {
                        // LOG_CYCLE 'adjust caret right position' INDEX caretPos
                        // dl.logCycle('adjust caret right position', caretPos);

                        caretPos--;
                        // LOG caretPos
                        // dl.log('caretPos', caretPos);

                        // GOL
                        // dl.endLog();
                    }

                    while (isKeyDelete && caretPos < caretPosMax && maskCaretMap.indexOf(caretPos) === -1) {
                        // LOG_CYCLE 'adjust caret left position' INDEX caretPos
                        // dl.logCycle('adjust caret left position', caretPos);

                        caretPos++;
                        // dl.log('caretPos', caretPos);

                        // GOL
                        // dl.endLog();
                    }

                    var charIndex = maskCaretMap.indexOf(caretPos);
                    // dl.log('charIndex', charIndex);

                    // Strip out non-mask character that user would have deleted if mask hadn't been in the way.
                    valUnmasked = valUnmasked.substring(0, charIndex) + valUnmasked.substring(charIndex + 1);
                    // dl.log('valUnmasked', valUnmasked);

                    // If value has not changed, don't want to call $setViewValue, may be caused by IE raising input event due to placeholder
                    if (valUnmasked !== valUnmaskedOld) {
                        // dl.log('unmasked value not equal to old unmasked value');

                        valAltered = true;
                        // dl.log('valAltered', valAltered);
                    }
                }

                // Update values
                valMasked = maskValue(valUnmasked);
                // dl.log('valMasked', valMasked);

                oldValue = valMasked;
                // dl.log('valMasked', valMasked);

                oldValueUnmasked = valUnmasked;
                // dl.log('oldValueUnmasked', oldValueUnmasked);

                //additional check to fix the problem where the viewValue is out of sync with the value of the element.
                //better fix for commit 2a83b5fb8312e71d220a497545f999fc82503bd9 (I think)
                if (!valAltered && val.length > valMasked.length) {
                    // dl.log('aditional check');

                    valAltered = true;
                    // dl.log('valAltered', valAltered);
                }

                iElement.val(valMasked);

                //we need this check.  What could happen if you don't have it is that you'll set the model value without the user
                //actually doing anything.  Meaning, things like pristine and touched will be set.
                if (valAltered) {
                    // dl.log('value altered');

                    scope.$apply(function () {
                        controller.$setViewValue(valMasked); // $setViewValue should be run in angular context, otherwise the changes will be invisible to angular and user code.
                    });
                }

                // Caret Repositioning
                // ===================

                // Ensure that typing always places caret ahead of typed character in cases where the first char of
                // the input is a mask char and the caret is placed at the 0 position.
                if (isAddition && (caretPos <= caretPosMin)) {
                    // dl.log('place caret ahead');

                    caretPos = caretPosMin + 1;
                    // dl.log('caretPos', caretPos);
                }

                if (caretBumpBack) {
                    // dl.log('bump caret back');

                    caretPos--;
                    // dl.log('caretPos', caretPos);
                }

                // Make sure caret is within min and max position limits
                caretPos = caretPos > caretPosMax ? caretPosMax : caretPos < caretPosMin ? caretPosMin : caretPos;
                // dl.log('caretPos', caretPos);

                // Scoot the caret back or forth until it's in a non-mask position and within min/max position limits
                while (!isValidCaretPosition(caretPos) && caretPos > caretPosMin && caretPos < caretPosMax) {
                    // LOG_CYCLE 'fix caret position' INDEX caretBumpBack
                    // dl.logCycle('fix caret position', caretBumpBack);

                    caretPos += caretBumpBack ? -1 : 1;
                    // dl.log('caretPos', caretPos);

                    // GOL
                    // dl.endLog();
                }

                if ((caretBumpBack && caretPos < caretPosMax) || (isAddition && !isValidCaretPosition(caretPosOld))) {
                    // dl.log('move caret ahead');

                    caretPos++;
                    // dl.log('caretPos', caretPos);
                }

                oldCaretPosition = caretPos;
                // dl.log('oldCaretPosition', oldCaretPosition);

                setCaretPosition(this, caretPos);

                // GOL
                // dl.endLog();
            }

            function isValidCaretPosition(pos) {
                // LOG_FUNCTION isValidCaretPosition
                // dl.logFunction(isValidCaretPosition);

                // dl.log('pos', pos);

                var posIndex = maskCaretMap.indexOf(pos);
                // dl.log('posIndex', posIndex);

                var result = posIndex > -1;

                // GOL result
                // dl.endLog(result);
                return result;
            }

            function getCaretPosition(input) {
                // LOG_FUNCTION getCaretPosition
                // dl.logFunction(getCaretPosition);

                var result = 0;

                if (!input) {
                    // dl.log('without input');

                    // GOL result
                    // dl.endLog(result);
                    return result;
                }

                if (input.selectionStart !== undefined) {
                    // dl.log('with input selection start');

                    result = input.selectionStart;

                    // GOL result
                    // dl.endLog(result);
                    return result;
                } else if (document.selection) {
                    // dl.log('with document selection');

                    var elem = iElement[0];

                    if (isFocused(elem)) {
                        // Curse you IE
                        // dl.log('focused element');

                        input.focus();

                        var selection = document.selection.createRange();
                        // dl.log('selection', selection);

                        var inputValue = input.value;
                        // dl.log('inputValue', inputValue);

                        selection.moveStart('character', inputValue ? -inputValue.length : 0);

                        var result = selection.text.length || 0;
                        // GOL result
                        // dl.endLog(result);
                        return result;
                    }
                }

                // GOL result
                // dl.endLog(result);
                return result;
            }

            function setCaretPosition(input, pos) {
                // LOG_FUNCTION setCaretPosition
                // dl.logFunction(setCaretPosition);

                // dl.log('pos', pos);

                var result = 0;

                if (!input) {
                    // dl.log('without input');

                    // GOL result
                    // dl.endLog(result);
                    return result;
                }

                if (input.offsetWidth === 0 || input.offsetHeight === 0) {
                    // dl.log('input hidden');

                    // GOL
                    // dl.endLog();
                    return; // Input's hidden
                }

                if (input.setSelectionRange) {
                    // dl.log('setSelectionRange');

                    var elem = iElement[0];

                    if (isFocused(elem)) {
                        // dl.log('focusedElem')

                        input.focus();
                        input.setSelectionRange(pos, pos);
                    }
                } else if (input.createTextRange) {
                    // dl.log('createTextRange');
                    // Curse you IE
                    var range = input.createTextRange();
                    range.collapse(true);
                    range.moveEnd('character', pos);
                    range.moveStart('character', pos);
                    range.select();
                }

                // GOL
                // dl.endLog();
            }

            function getSelectionLength(input) {
                // LOG_FUNCTION getSelectionLength
                // dl.logFunction(getSelectionLength);

                var result = 0;

                if (!input) {
                    // dl.log('without input');

                    // GOL result
                    // dl.endLog(result);
                    return result;
                }

                if (input.selectionStart !== undefined) {
                    // dl.log('with start selection');

                    result = input.selectionEnd - input.selectionStart;

                    // GOL result
                    // dl.endLog(result);
                    return result;
                }

                if (window.getSelection) {
                    // dl.log('getSelection');

                    var windowSelection = window.getSelection().toString();
                    // dl.log('windowSelection', windowSelection);

                    result = windowSelection.length;

                    // GOL result
                    // dl.endLog(result);
                    return result;
                }

                if (document.selection) {
                    // dl.log('doumentSelection');

                    var selectionRange = document.selection.createRange().text;
                    // dl.log('selectionRange', selectionRange);

                    result = doumentSelection.length;
                    // dl.log('result', result);

                    // dl.endLog();
                    return result;
                }

                // dl.log('result', result);

                // dl.endLog();
                return result;
            }
        }
    }

    function isFocused(elem) {
        // LOG_FUNCTION isFocused
        // dl.logFunction(isFocused);

        var isDocumentActiveElement = elem === document.activeElement;
        // dl.log('isDocumentActiveElement', isDocumentActiveElement);

        // dl.log('documentHasFocus', document.hasFocus);
        // dl.log('documentHasFocus()', document.hasFocus());

        var documentHasFocus = !document.hasFocus || document.hasFocus()
        // dl.log('documentHasFocus', documentHasFocus);

        var mysteriousCheck = !!(elem.type || elem.href || ~elem.tabIndex);
        // dl.log('mysteriousCheck', mysteriousCheck);

        var result = documentHasFocus && isDocumentActiveElement && mysteriousCheck;

        // GOL result
        // dl.endLog(result);

        return result;
    }

    function maskConfigProvider() {
        var options = {};

        this.maskDefinitions = function (maskDefinitions) {
            return options.maskDefinitions = maskDefinitions;
        };

        this.clearOnBlur = function (clearOnBlur) {
            return options.clearOnBlur = clearOnBlur;
        };

        this.clearOnBlurPlaceholder = function (clearOnBlurPlaceholder) {
            return options.clearOnBlurPlaceholder = clearOnBlurPlaceholder;
        };

        this.eventsToHandle = function (eventsToHandle) {
            return options.eventsToHandle = eventsToHandle;
        };

        this.addDefaultPlaceholder = function (addDefaultPlaceholder) {
            return options.addDefaultPlaceholder = addDefaultPlaceholder;
        };

        this.allowInvalidValue = function (allowInvalidValue) {
            return options.allowInvalidValue = allowInvalidValue;
        };

        this.$get = ['uiMaskConfig', function (uiMaskConfig) {
            var tempOptions = uiMaskConfig;
            for (var prop in options) {
                if (angular.isObject(options[prop]) && !angular.isArray(options[prop])) {
                    angular.extend(tempOptions[prop], options[prop]);
                } else {
                    tempOptions[prop] = options[prop];
                }
            }

            return tempOptions;
        }];
    }

    // https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/Array/indexOf
    if (!Array.prototype.indexOf) {
        Array.prototype.indexOf = function (searchElement /*, fromIndex */) {
            if (this === null) {
                throw new TypeError();
            }
            var t = Object(this);
            var len = t.length >>> 0;
            if (len === 0) {
                return -1;
            }
            var n = 0;
            if (arguments.length > 1) {
                n = Number(arguments[1]);
                if (n !== n) { // shortcut for verifying if it's NaN
                    n = 0;
                } else if (n !== 0 && n !== Infinity && n !== -Infinity) {
                    n = (n > 0 || -1) * Math.floor(Math.abs(n));
                }
            }
            if (n >= len) {
                return -1;
            }
            var k = n >= 0 ? n : Math.max(len - Math.abs(n), 0);
            for (; k < len; k++) {
                if (k in t && t[k] === searchElement) {
                    return k;
                }
            }
            return -1;
        };
    }

    //function DebugLog() {
    //    this._rootLogEntity;
    //}

    //DebugLog.prototype.log = function (variableName, variable) {
    //    var logEntity = {};
    //    logEntity[variableName] = variable === undefined ? '' : JSON.stringify(variable);

    //    if (this._rootLogEntity) {
    //        this._saveLogEntity(logEntity);
    //        return;
    //    }

    //    this._rootLogEntity = logEntity;
    //    this._outputRootLogEntity();
    //};

    //DebugLog.prototype.logFunction = function (func) {
    //    var logEntity = {
    //        name: func.toString().match(/function ([^)]*\)?)/i)[1],
    //        parent: this._rootLogEntity
    //    }

    //    logEntity[logEntity.name] = '';

    //    this._saveLogEntity(logEntity);
    //    this._rootLogEntity = logEntity;
    //};

    //DebugLog.prototype.logCycle = function (cycleName, index) {
    //    var logEntity = {
    //        parent: this._rootLogEntity
    //    };

    //    logEntity[cycleName + ', index:'] = index;

    //    this._saveLogEntity(logEntity);
    //    this._rootLogEntity = logEntity;
    //};

    //DebugLog.prototype.endLog = function (result) {
    //    var parentObject = this._rootLogEntity.parent;
    //    delete this._rootLogEntity.parent;

    //    var entityName = this._rootLogEntity.name;
    //    if (entityName) {
    //        // undefined result don't print inside json object
    //        this._rootLogEntity[entityName] = result === undefined && 'undefined' || result;
    //        delete this._rootLogEntity.name;
    //    }

    //    if (parentObject) {
    //        this._rootLogEntity = parentObject;
    //        return;
    //    }

    //    this._outputRootLogEntity();
    //};

    //DebugLog.prototype._outputRootLogEntity = function () {
    //    console.log(JSON.stringify(this._rootLogEntity) + ',');
    //    delete this._rootLogEntity;
    //};

    //DebugLog.prototype._saveLogEntity = function (logEntity) {
    //    if (!this._rootLogEntity) {
    //        this._rootLogEntity = logEntity;
    //        return;
    //    }

    //    this._rootLogEntity.details = this._rootLogEntity.details || [];
    //    this._rootLogEntity.details.push(logEntity);
    //};
}());