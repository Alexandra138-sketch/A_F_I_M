export function lerCookie(req, nome) {
    const cabecalho = req.get('Cookie');

    if (!cabecalho) {
        return null;
    }

    const cookies = cabecalho.split(';');

    for (const cookie of cookies) {
        const partes = cookie.trim().split('=');
        const nomeCookie = partes.shift();
        const valorCookie = partes.join('=');

        if (nomeCookie === nome) {
            return valorCookie;
        }
    }

    return null;
}
