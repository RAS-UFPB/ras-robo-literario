function getSwaggerSpec() {
  return {
    openapi: '3.0.0',
    info: {
      title: 'API Robô Literário RAS',
      version: '1.0.0',
      description: 'Documentação da API do MVP do Robô Literário.'
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Servidor local'
      }
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'Token'
            }
        }
    },
    paths: {
      '/api/auth/login': {
        post: {
          summary: 'Realiza login admin/dev usando chave secreta',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    accessKey: {
                      type: 'string',
                      example: 'sua senha admin'
                    }
                  },
                  required: ['accessKey']
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Login realizado com sucesso'
            },
            401: {
              description: 'Chave inválida'
            }
          }
        }
      },

      '/api/ping': {
        get: {
          summary: 'Verifica se a API está online',
          responses: {
            200: {
              description: 'API online'
            }
          }
        }
      },

      '/api/supabase/status': {
        get: {
          summary: 'Verifica se o Supabase está conectado',
          responses: {
            200: {
              description: 'Status da conexão com Supabase'
            }
          }
        }
      },

      '/api/atividade': {
        get: {
          summary: 'Busca a atividade atual',
          responses: {
            200: {
              description: 'Atividade atual'
            }
          }
        },
        post: {
          summary: 'Inicia uma nova atividade',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    textoAlvo: {
                      type: 'string',
                      example: 'o menino maluquinho'
                    }
                  },
                  required: ['textoAlvo']
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Atividade criada com sucesso'
            }
          }
        }
      },

      '/api/qr': {
        post: {
          summary: 'Registra leitura enviada pela ESP32-CAM',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    equipe: {
                      type: 'string',
                      example: 'Equipe 1'
                    },
                    codigoBinario: {
                      type: 'string',
                      example: '0000'
                    }
                  },
                  required: ['equipe', 'codigoBinario']
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Leitura registrada'
            }
          }
        }
      },

      '/api/qr/latest': {
        get: {
          summary: 'Retorna a última leitura recebida',
          responses: {
            200: {
              description: 'Última leitura'
            }
          }
        }
      },

      '/api/leituras': {
        get: {
          summary: 'Lista as leituras de uma equipe',
          parameters: [
            {
              name: 'equipe',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                example: 'Equipe 1'
              }
            }
          ],
          responses: {
            200: {
              description: 'Leituras da equipe'
            }
          }
        }
      },

      '/api/validar': {
        post: {
          summary: 'Valida a sequência enviada por uma equipe',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    equipe: {
                      type: 'string',
                      example: 'Equipe 1'
                    }
                  },
                  required: ['equipe']
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Resultado da validação'
            },
            400: {
              description: 'Erro de validação'
            }
          }
        }
      },

      '/api/placar': {
        get: {
          summary: 'Retorna o placar das equipes',
          responses: {
            200: {
              description: 'Placar das equipes'
            }
          }
        }
      },

      '/api/reset-equipe': {
        post: {
          summary: 'Limpa apenas a mesa de uma equipe, sem apagar sua pontuação',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    equipe: {
                      type: 'string',
                      example: 'Equipe 1'
                    }
                  },
                  required: ['equipe']
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Mesa da equipe limpa'
            }
          }
        }
      },

      '/api/admin/reset-json': {
        post: {
          summary: 'Apaga todos os dados do banco local db.json',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Banco local resetado'
            }
          }
        }
      },

      '/api/admin/reset-supabase': {
        post: {
          summary: 'Apaga os dados das tabelas do Supabase',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Supabase resetado'
            }
          }
        }
      },

      '/api/admin/reset-tudo': {
        post: {
          summary: 'Apaga dados locais e tenta apagar também os dados do Supabase',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Reset geral executado'
            }
          }
        }
      }
    }
  };
}

function sendSwaggerJson(res, sendJson) {
  return sendJson(res, 200, getSwaggerSpec());
}

function sendSwaggerUi(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

  return res.end(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <title>Swagger - Robô Literário RAS</title>
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
      <style>
        body {
          margin: 0;
          background: #fafafa;
        }
      </style>
    </head>
    <body>
      <div id="swagger-ui"></div>

      <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
      <script>
        window.onload = () => {
          SwaggerUIBundle({
            url: '/api/docs.json',
            dom_id: '#swagger-ui'
          });
        };
      </script>
    </body>
    </html>
  `);
}

module.exports = {
  sendSwaggerJson,
  sendSwaggerUi
};