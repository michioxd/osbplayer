function log(msg: any[], logType: "log" | "error" | "warn") {
    const ct = document.getElementById("logger");
    switch (logType) {
        case "log":
            console.log(...msg);
            break;
        case "error":
            console.error(...msg);
            break;
        case "warn":
            console.warn(...msg);
            break;
    }
    if (ct) {
        const stringMessages = msg.filter(item => typeof item === 'string');
        if (stringMessages.length > 0) {
            ct.innerHTML += `<span class="${logType}">${stringMessages.join(" ")}</span>`;
        }
        ct.scrollTop = ct.scrollHeight;
    }
}

const lg = {
    log: (...msg: any[]) => log(msg, "log"),
    error: (...msg: any[]) => log(msg, "error"),
    warn: (...msg: any[]) => log(msg, "warn"),
}

export default lg;