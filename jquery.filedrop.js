/*global jQuery:false, alert:false */

/*
 * Default text - jQuery plugin for html5 dragging files from desktop to browser
 *
 * Author: Weixi Yen
 *
 * Email: [Firstname][Lastname]@gmail.com
 *
 * Copyright (c) 2010 Resopollution
 *
 * Licensed under the MIT license:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Project home:
 *   http://www.github.com/weixiyen/jquery-filedrop
 *
 * Version:  0.1.0
 *
 * Features:
 *      Allows sending of extra parameters with file.
 *      Works with Firefox 3.6+
 *      Future-compliant with HTML5 spec (will work with Webkit browsers and IE9)
 * Usage:
 *  See README at project homepage
 *
 */
;
(function ($) {

    jQuery.event.props.push("dataTransfer");

    var default_opts = {
            fallback_id: '',
            url: '',
            refresh: 1000,
            paramname: 'userfile',
            requestType: 'POST',    // just in case you want to use another HTTP verb
            allowedfileextensions: [],
            allowedfiletypes: [],
            maxfiles: 25,           // Ignored if queuefiles is set > 0
            maxfilesize: 1,         // MB file size limit
            queuefiles: 0,          // Max files before queueing (for large volume uploads)
            queuewait: 200,         // Queue wait time if full
            data: {},
            headers: {
                "X-Requested-With": "XMLHttpRequest"
            },
            drop: empty,
            dragStart: empty,
            dragEnter: empty,
            dragOver: empty,
            dragLeave: empty,
            docEnter: empty,
            docOver: empty,
            docLeave: empty,
            beforeEach: empty,
            beforeSend: null,
            afterAll: empty,
            rename: empty,
            error: function(err, file, i, status) {
                console.error(err, file, i, status);
            },
            uploadStarted: empty,
            uploadFinished: empty,
            progressUpdated: empty,
            globalProgressUpdated: empty,
            speedUpdated: empty
        },
        errors = ["BrowserNotSupported", "TooManyFiles", "FileTooLarge", "FileTypeNotAllowed", "NotFound", "NotReadable", "AbortError", "ReadError", "FileExtensionNotAllowed"];

    $.fn.filedrop = function (options) {
        var opts = $.extend({}, default_opts, options),
            global_progress = [],
            _doc_leave_timer,
            _stop_loop = false,
            _files_count = 0,
            _files;

        $('#' + opts.fallback_id).css({
            display: 'none',
            width: 0,
            height: 0
        });

        this.on('drop', drop)
            .on('dragstart', opts.dragStart)
            .on('dragenter', dragEnter)
            .on('dragover', dragOver)
            .on('dragleave', dragLeave);
        $(document).on('drop', docDrop)
            .on('dragenter', docEnter)
            .on('dragover', docOver)
            .on('dragleave', docLeave);

        if(opts.fallback_id){
            this.on('click', function (e) {
                $('#' + opts.fallback_id).trigger(e);
            });

            $('#' + opts.fallback_id).change(function (e) {
                opts.drop(e);
                _files = e.target.files;
                _files_count = _files.length;
                upload();
            });
        }

        function drop(e) {
            if (opts.drop.call(this, e) === false) return false;
            if (!e.dataTransfer) return;

            _files = e.dataTransfer.files;
            if (_files === null || _files === undefined || _files.length === 0) {
                opts.error(errors[0]);
                return false;
            }
            _files_count = _files.length;
            upload();
            e.preventDefault();
            return false;
        }

        function uploadProgress(e) {
            if (e.lengthComputable) {
                var data = this.customData,
                    percentage = Math.round((e.loaded * 100) / e.total);
                if (data.currentProgress !== percentage) {

                    data.currentProgress = percentage;
                    opts.progressUpdated(data.index, data.file, data.currentProgress);

                    global_progress[data.global_progress_index] = data.currentProgress;
                    globalProgress();

                    var elapsed = new Date().getTime();
                    var diffTime = elapsed - data.currentStart;
                    if (diffTime >= opts.refresh) {
                        var diffData = e.loaded - data.startData;
                        var speed = diffData / diffTime; // KB per second
                        opts.speedUpdated(data.index, data.file, speed);
                        data.startData = e.loaded;
                        data.currentStart = elapsed;
                    }
                }
            }
        }

        function globalProgress() {
            if (global_progress.length === 0) {
                return;
            }

            var total = 0, index;
            for (index in global_progress) {
                if (global_progress.hasOwnProperty(index)) {
                    total = total + global_progress[index];
                }
            }

            opts.globalProgressUpdated(Math.round(total / global_progress.length));
        }

        // Respond to an upload
        function upload() {
            _stop_loop = false;

            if (!_files) {
                opts.error(errors[0]);
                return false;
            }

            if (opts.allowedfiletypes.push && opts.allowedfiletypes.length) {
                for (var fileIndex = _files.length; fileIndex--;) {
                    if (!_files[fileIndex].type || $.inArray(_files[fileIndex].type, opts.allowedfiletypes) < 0) {
                        opts.error(errors[3], _files[fileIndex]);
                        return false;
                    }
                }
            }

            if (opts.allowedfileextensions.push && opts.allowedfileextensions.length) {
                for (var fileIndex = _files.length; fileIndex--;) {
                    var allowedextension = false;
                    for (i = 0; i < opts.allowedfileextensions.length; i++) {
                        if (_files[fileIndex].name.substr(_files[fileIndex].name.length - opts.allowedfileextensions[i].length) == opts.allowedfileextensions[i]) {
                            allowedextension = true;
                        }
                    }
                    if (!allowedextension) {
                        opts.error(errors[8], _files[fileIndex]);
                        return false;
                    }
                }
            }

            var filesDone = 0,
                filesRejected = 0;

            if (_files_count > opts.maxfiles && opts.queuefiles === 0) {
                opts.error(errors[1]);
                return false;
            }

            // Define queues to manage upload process
            var workQueue = [];
            var processingQueue = [];
            var doneQueue = [];

            // Add everything to the workQueue
            for (var i = 0; i < _files_count; i++) {
                workQueue.push(i);
            }

            // Helper function to enable pause of processing to wait
            // for in process queue to complete
            var pause = function (timeout) {
                setTimeout(process, timeout);
                return;
            };

            // Process an upload, recursive
            var process = function () {
                var fileIndex;

                if (_stop_loop) {
                    return false;
                }

                // Check to see if are in queue mode
                if (opts.queuefiles > 0 && processingQueue.length >= opts.queuefiles) {
                    return pause(opts.queuewait);
                } else {
                    // Take first thing off work queue
                    fileIndex = workQueue[0];
                    workQueue.splice(0, 1);

                    // Add to processing queue
                    processingQueue.push(fileIndex);
                }

                try {
                    if (beforeEach(_files[fileIndex]) !== false) {
                        if (fileIndex === _files_count) {
                            return;
                        }
                        var reader = new FileReader(),
                            max_file_size = opts.maxfilesize * 1048576;//1048576 is 1 MByte

                        reader.index = fileIndex;
                        if (_files[fileIndex].size > max_file_size) {
                            opts.error(errors[2], _files[fileIndex], fileIndex);
                            // Remove from queue
                            processingQueue.forEach(function (value, key) {
                                if (value === fileIndex) {
                                    processingQueue.splice(key, 1);
                                }
                            });
                            filesRejected++;
                            return true;
                        }

                        reader.onerror = function (e) {
                            switch (e.target.error.code) {
                                case e.target.error.NOT_FOUND_ERR:
                                    opts.error(errors[4]);
                                    return false;
                                case e.target.error.NOT_READABLE_ERR:
                                    opts.error(errors[5]);
                                    return false;
                                case e.target.error.ABORT_ERR:
                                    opts.error(errors[6]);
                                    return false;
                                default:
                                    opts.error(errors[7]);
                                    return false;
                            }
                        }

                        reader.onloadend = !opts.beforeSend ? send : function (e) {
                            opts.beforeSend(_files[fileIndex], fileIndex, function () {
                                send(e);
                            });
                        }

                        reader.readAsDataURL(_files[fileIndex]);

                    } else {
                        filesRejected++;
                    }
                } catch (err) {
                    // Remove from queue
                    processingQueue.forEach(function (value, key) {
                        if (value === fileIndex) {
                            processingQueue.splice(key, 1);
                        }
                    });
                    opts.error(errors[0]);
                    return false;
                }

                // If we still have work to do,
                if (workQueue.length > 0) {
                    process();
                }
            };

            var send = function (e) {
                var fileIndex = (e.srcElement || e.target).index;

                // Sometimes the index is not attached to the
                // event object. Find it by size. Hack for sure.
                if (e.target.index === undefined) {
                    e.target.index = getIndexBySize(e.total);
                }

                var xhr = new XMLHttpRequest(),
                    file = _files[e.target.index],
                    index = e.target.index,
                    start_time = new Date().getTime(),
                    global_progress_index = global_progress.length;

                if (opts.withCredentials) {
                    xhr.withCredentials = opts.withCredentials;
                }


                xhr.upload.customData = {
                    index : index,
                    file : file,
                    downloadStartTime : start_time,
                    currentStart : start_time,
                    currentProgress : 0,
                    global_progress_index : global_progress_index,
                    startData : 0
                };
                xhr.upload.onprogress = uploadProgress;
                // Allow url to be a method
                xhr.open(opts.requestType, (jQuery.isFunction(opts.url) ? opts.url() :opts.url), true);

                $.each(opts.headers, function (k, v) {
                    xhr.setRequestHeader(k, v);
                });

                xhr.onload = function () {
                    console.log('xhr onload');
                    var serverResponse = null;

                    if (xhr.responseText) {
                        try {
                            serverResponse = jQuery.parseJSON(xhr.responseText);
                        } catch (e) {
                            serverResponse = xhr.responseText;
                        }
                    }

                    var now = new Date().getTime(),
                        timeDiff = now - start_time,
                        result = opts.uploadFinished(index, file, serverResponse, timeDiff, xhr);
                    filesDone++;

                    // Remove from processing queue
                    processingQueue.forEach(function (value, key) {
                        if (value === fileIndex) {
                            processingQueue.splice(key, 1);
                        }
                    });

                    // Add to donequeue
                    doneQueue.push(fileIndex);

                    // Make sure the global progress is updated
                    global_progress[global_progress_index] = 100;
                    globalProgress();

                    if (filesDone === (_files_count - filesRejected)) {
                        afterAll();
                    }
                    if (result === false) {
                        _stop_loop = true;
                    }


                    // Pass any errors to the error option
                    if (xhr.status < 200 || xhr.status > 299) {
                        opts.error(xhr.statusText, file, fileIndex, xhr.status);
                    }
                };

                var formData = new FormData();
                if (opts.data) {
                    $.each(opts.data, function (k, v) {
                        formData.append(k,v);
                    });
                }

                formData.append( opts.paramname, file);

                xhr.send(formData)

                global_progress[global_progress_index] = 0;
                globalProgress();

                opts.uploadStarted(index, file, _files_count);
            };

            // Initiate the processing loop
            process();
        }

        function getIndexBySize(size) {
            for (var i = 0; i < _files_count; i++) {
                if (_files[i].size === size) {
                    return i;
                }
            }

            return undefined;
        }

        function rename(name) {
            return opts.rename(name);
        }

        function beforeEach(file) {
            return opts.beforeEach(file);
        }

        function afterAll() {
            return opts.afterAll();
        }

        function dragEnter(e) {
            clearTimeout(_doc_leave_timer);
            e.preventDefault();
            opts.dragEnter.call(this, e);
        }

        function dragOver(e) {
            clearTimeout(_doc_leave_timer);
            e.preventDefault();
            opts.docOver.call(this, e);
            opts.dragOver.call(this, e);
        }

        function dragLeave(e) {
            clearTimeout(_doc_leave_timer);
            opts.dragLeave.call(this, e);
            e.stopPropagation();
        }

        function docDrop(e) {
            e.preventDefault();
            opts.docLeave.call(this, e);
            return false;
        }

        function docEnter(e) {
            clearTimeout(_doc_leave_timer);
            e.preventDefault();
            opts.docEnter.call(this, e);
            return false;
        }

        function docOver(e) {
            clearTimeout(_doc_leave_timer);
            e.preventDefault();
            opts.docOver.call(this, e);
            return false;
        }

        function docLeave(e) {
            _doc_leave_timer = setTimeout((function (_this) {
                return function () {
                    opts.docLeave.call(_this, e);
                };
            })(this), 200);
        }

        return this;
    };

    function empty() {
    }

    try {
        if (XMLHttpRequest.prototype.sendAsBinary) {
            return;
        }
        XMLHttpRequest.prototype.sendAsBinary = function (datastr) {
            function byteValue(x) {
                return x.charCodeAt(0) & 0xff;
            }

            var ords = Array.prototype.map.call(datastr, byteValue);
            var ui8a = new Uint8Array(ords);

            // Not pretty: Chrome 22 deprecated sending ArrayBuffer, moving instead
            // to sending ArrayBufferView.  Sadly, no proper way to detect this
            // functionality has been discovered.  Happily, Chrome 22 also introduced
            // the base ArrayBufferView class, not present in Chrome 21.
            if ('ArrayBufferView' in window)
                this.send(ui8a);
            else
                this.send(ui8a);
        };
    } catch (e) {
    }

})(jQuery);
