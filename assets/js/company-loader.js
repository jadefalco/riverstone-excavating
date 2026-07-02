/**
 * Company Data Loader
 *
 * Loads company-specific content from content/company.md and binds it to the DOM.
 * No build step, no npm dependencies — plain vanilla JS.
 *
 * Markup conventions:
 *   - data-company="path.to.value"        -> single value
 *   - data-company-list="path.to.array"   -> repeating list container
 *   - data-company-item                   -> template child inside a list container
 *   - data-company-item-field="key"       -> field inside a list item
 */

(function () {
    'use strict';

    let baseUrl = '';

    // ------------------------------------------------------------------
    // Minimal YAML front-matter parser (maps, arrays, scalars, | literals)
    // ------------------------------------------------------------------
    function parseFrontMatter(text) {
        const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
        if (!match) return {};
        return parseYAML(match[1]);
    }

    function parseYAML(text) {
        const lines = text.split('\n').map(function (raw) {
            const trimmed = raw.trim();
            const indent = raw.search(/\S/);
            return {
                raw: raw,
                trimmed: trimmed,
                indent: indent,
                isBlank: trimmed === '',
                isComment: trimmed.startsWith('#')
            };
        });

        function skipBlanksAndComments(idx) {
            while (idx < lines.length && (lines[idx].isBlank || lines[idx].isComment)) {
                idx++;
            }
            return idx;
        }

        function parseScalar(v) {
            if (v === 'true') return true;
            if (v === 'false') return false;
            if (v === 'null' || v === '~') return null;
            if (/^-?\d+$/.test(v)) return parseInt(v, 10);
            if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                return v.slice(1, -1);
            }
            return v;
        }

        function parseMap(startIdx, parentIndent) {
            const result = {};
            let i = skipBlanksAndComments(startIdx);
            while (i < lines.length) {
                const line = lines[i];
                if (line.indent <= parentIndent) break;
                if (line.isBlank || line.isComment) { i++; continue; }

                const colonIdx = line.trimmed.indexOf(':');
                if (colonIdx === -1) { i++; continue; }

                const key = line.trimmed.slice(0, colonIdx).trim();
                let value = line.trimmed.slice(colonIdx + 1).trim();

                if (value === '|') {
                    i++;
                    const parts = [];
                    const contentIndent = line.indent + 2;
                    while (i < lines.length) {
                        const next = lines[i];
                        if (!next.isBlank && next.indent < contentIndent) break;
                        if (next.isBlank) {
                            parts.push('');
                        } else {
                            parts.push(next.raw.slice(contentIndent));
                        }
                        i++;
                    }
                    result[key] = parts.join('\n');
                } else if (value === '') {
                    const nextIdx = skipBlanksAndComments(i + 1);
                    const next = lines[nextIdx];
                    if (!next) {
                        result[key] = null;
                        i++;
                    } else if (next.trimmed.startsWith('- ')) {
                        const parsed = parseArray(nextIdx, line.indent);
                        result[key] = parsed.value;
                        i = parsed.nextIdx;
                    } else {
                        const parsed = parseMap(nextIdx, line.indent);
                        result[key] = parsed.value;
                        i = parsed.nextIdx;
                    }
                } else {
                    result[key] = parseScalar(value);
                    i++;
                }
                i = skipBlanksAndComments(i);
            }
            return { value: result, nextIdx: i };
        }

        function parseArray(startIdx, parentIndent) {
            const result = [];
            let i = skipBlanksAndComments(startIdx);
            while (i < lines.length) {
                const line = lines[i];
                if (line.indent <= parentIndent) break;
                if (line.isBlank || line.isComment) { i++; continue; }
                if (!line.trimmed.startsWith('- ')) break;

                const itemText = line.trimmed.slice(2).trim();
                const itemIndent = line.indent;

                if (itemText === '') {
                    const nextIdx = skipBlanksAndComments(i + 1);
                    const next = lines[nextIdx];
                    if (!next) {
                        result.push(null);
                        i++;
                    } else if (next.trimmed.startsWith('- ')) {
                        const parsed = parseArray(nextIdx, itemIndent);
                        result.push(parsed.value);
                        i = parsed.nextIdx;
                    } else {
                        const parsed = parseMap(nextIdx, itemIndent);
                        result.push(parsed.value);
                        i = parsed.nextIdx;
                    }
                } else if (itemText.includes(':')) {
                    const colonIdx = itemText.indexOf(':');
                    const firstKey = itemText.slice(0, colonIdx).trim();
                    const firstValue = itemText.slice(colonIdx + 1).trim();

                    let firstVal;
                    let j = i + 1;
                    if (firstValue === '|') {
                        const parts = [];
                        const contentIndent = itemIndent + 2;
                        while (j < lines.length) {
                            const next = lines[j];
                            if (!next.isBlank && next.indent < contentIndent) break;
                            if (next.isBlank) {
                                parts.push('');
                            } else {
                                parts.push(next.raw.slice(contentIndent));
                            }
                            j++;
                        }
                        firstVal = parts.join('\n');
                    } else {
                        firstVal = parseScalar(firstValue);
                    }

                    const parsed = parseMap(j, itemIndent);
                    const obj = { [firstKey]: firstVal };
                    Object.assign(obj, parsed.value);
                    result.push(obj);
                    i = parsed.nextIdx;
                } else {
                    result.push(parseScalar(itemText));
                    i++;
                }
                i = skipBlanksAndComments(i);
            }
            return { value: result, nextIdx: i };
        }

        if (lines.length === 0) return {};
        const firstReal = skipBlanksAndComments(0);
        if (firstReal >= lines.length) return {};
        if (lines[firstReal].trimmed.startsWith('- ')) {
            return parseArray(firstReal, -1).value;
        }
        return parseMap(firstReal, -1).value;
    }

    // ------------------------------------------------------------------
    // Data binding helpers
    // ------------------------------------------------------------------
    function getValue(obj, path) {
        return path.split('.').reduce(function (acc, key) {
            return acc && acc[key] !== undefined ? acc[key] : undefined;
        }, obj);
    }

    function resolveUrl(value) {
        if (value === null || value === undefined) return value;
        const str = String(value).trim();
        if (str === '') return str;
        if (/^(https?:|\/\/|data:|mailto:|tel:|#)/i.test(str)) return str;
        if (str.startsWith('/')) return baseUrl + str;
        return baseUrl + '/' + str;
    }

    function setContent(el, value) {
        const str = value === null || value === undefined ? '' : String(value);
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
            el.value = str;
        } else if (el.tagName === 'IMG') {
            // src/alt are set via dedicated bindings; fallback here
            el.alt = str;
        } else if (el.tagName === 'TITLE') {
            el.textContent = str;
        } else if (str.indexOf('\n\n') !== -1) {
            // Preserve paragraph breaks for multi-paragraph text
            el.innerHTML = str.split('\n\n').map(function (p) {
                return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
            }).join('');
        } else {
            el.innerHTML = str.replace(/\n/g, '<br>');
        }
    }

    function setAttribute(el, attr, value) {
        if (value === null || value === undefined) return;
        if (attr === 'href') {
            // Smart href handling for contact links
            const path = el.dataset.companyHref || '';
            if (path.indexOf('phone') !== -1) {
                el.href = 'tel:' + String(value).replace(/\s+/g, '');
            } else if (path.indexOf('email') !== -1) {
                el.href = 'mailto:' + value;
            } else {
                el.href = resolveUrl(value);
            }
        } else if (attr === 'value' && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
            el.value = value;
        } else if (attr === 'src') {
            el.setAttribute(attr, resolveUrl(value));
        } else {
            el.setAttribute(attr, value);
        }
    }

    function applySingleBinding(el, company, attrName) {
        let path, targetAttr;
        if (attrName === 'company') {
            path = el.dataset.company;
            targetAttr = null;
        } else {
            path = el.getAttribute('data-company-' + attrName);
            targetAttr = attrName;
        }

        const value = getValue(company, path);
        if (value === undefined) return;

        if (targetAttr) {
            setAttribute(el, targetAttr, value);
        } else {
            if (el.tagName === 'A') {
                if (path.indexOf('phone') !== -1) {
                    el.href = 'tel:' + String(value).replace(/\s+/g, '');
                } else if (path.indexOf('email') !== -1) {
                    el.href = 'mailto:' + value;
                } else if (path.indexOf('credits_url') !== -1 || path.indexOf('url') !== -1) {
                    el.href = value;
                }
            }
            setContent(el, value);
        }
    }

    function fillFields(el, data) {
        // Content bindings inside list items
        el.querySelectorAll('[data-company-item-field]').forEach(function (fieldEl) {
            const key = fieldEl.dataset.companyItemField;
            if (data[key] !== undefined) {
                setContent(fieldEl, data[key]);
            }
        });

        // Attribute bindings inside list items (e.g. data-company-item-field-src)
        el.querySelectorAll('*').forEach(function (fieldEl) {
            Array.from(fieldEl.attributes).forEach(function (attr) {
                if (attr.name === 'data-company-item-field') return;
                if (attr.name.startsWith('data-company-item-field-')) {
                    const targetAttr = attr.name.slice('data-company-item-field-'.length);
                    const key = attr.value;
                    if (data[key] !== undefined) {
                        setAttribute(fieldEl, targetAttr, data[key]);
                    }
                }
            });
        });
    }

    function bindLists(company) {
        document.querySelectorAll('[data-company-list]').forEach(function (container) {
            const path = container.dataset.companyList;
            const items = getValue(company, path) || [];
            const templates = Array.from(container.querySelectorAll('[data-company-item]'));
            if (templates.length === 0) return;

            const fragment = document.createDocumentFragment();
            items.forEach(function (item, idx) {
                const template = templates[idx] || templates[0];
                const clone = template.cloneNode(true);
                clone.removeAttribute('data-company-item');
                clone.removeAttribute('id'); // avoid duplicate IDs
                fillFields(clone, item);
                fragment.appendChild(clone);
            });

            container.innerHTML = '';
            container.appendChild(fragment);
        });
    }

    function bindSingles(company) {
        const attrPrefix = 'data-company';
        document.querySelectorAll('[' + attrPrefix + ']').forEach(function (el) {
            applySingleBinding(el, company, 'company');
        });

        // Attribute-specific bindings: data-company-src, data-company-alt, data-company-href, etc.
        document.querySelectorAll('*').forEach(function (el) {
            Array.from(el.attributes).forEach(function (attr) {
                if (attr.name === attrPrefix) return;
                if (attr.name.startsWith(attrPrefix + '-')) {
                    const targetAttr = attr.name.slice(attrPrefix.length + 1);
                    applySingleBinding(el, company, targetAttr);
                }
            });
        });
    }

    function applyCompanyData(company) {
        window.company = company;
        bindSingles(company);
        bindLists(company);
        document.dispatchEvent(new CustomEvent('company:loaded', { detail: company }));
    }

    // ------------------------------------------------------------------
    // Bootstrap
    // ------------------------------------------------------------------
    // Capture the script element at execution time; document.currentScript
    // is unreliable once DOMContentLoaded has fired.
    const currentScript = document.currentScript;

    function getBaseUrl() {
        const script = currentScript || (function () {
            const scripts = document.querySelectorAll('script[src*="company-loader.js"]');
            return scripts[scripts.length - 1];
        })();
        if (!script || !script.src) return '';
        const scriptUrl = new URL(script.src);
        return scriptUrl.origin + scriptUrl.pathname.replace(/\/assets\/js\/company-loader\.js(?:\?.*)?$/, '');
    }

    function init() {
        baseUrl = getBaseUrl();
        if (!baseUrl) {
            console.warn('[company-loader] Could not determine site base URL. Image and link paths may not resolve correctly.');
        }

        const mdUrl = baseUrl + '/content/company.md';

        fetch(mdUrl)
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            })
            .then(function (text) {
                const company = parseFrontMatter(text);
                applyCompanyData(company);
            })
            .catch(function (err) {
                console.warn('[company-loader] Could not load company.md:', err);
                console.warn('[company-loader] If viewing locally, run a local server (e.g. npx serve or python -m http.server).');
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
