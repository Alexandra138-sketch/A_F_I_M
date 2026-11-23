'use strict';
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();

// Resposta provisória: o contrato existe, a funcionalidade ainda não.
const naoImplementado = (req, res) =>
  res.status(501).json({ erro: 'Não implementado' });

// As 8 operações do contrato (reporta.openapi.yaml)
app.get('/v1/categorias', naoImplementado);
app.get('/v1/ocorrencias/semelhantes', naoImplementado);
app.get('/v1/ocorrencias', naoImplementado);
app.post('/v1/ocorrencias', naoImplementado);
app.post('/v1/ocorrencias/:id/reforcos', naoImplementado);
app.get('/v1/ocorrencias/:id/fotografia', naoImplementado);
app.get('/v1/ocorrencias/alteracoes', naoImplementado);
app.patch('/v1/admin/ocorrencias/:id', naoImplementado);

// A PWA
app.use(express.static(path.join(__dirname, 'public')));

// Qualquer outra rota: 404
app.use((req, res) => res.status(404).json({ erro: 'Rota inexistente' }));

app.listen(PORT, () => console.log(`Reporta em http://localhost:${PORT}`));
