const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mysql = require('mysql2');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const xlsx = require('xlsx');
const multer = require('multer');
require('dotenv').config();
 
// Middleware para verificar el rol de usuario
function requireRole(...roles) {
  return (req, res, next) => {
      if (req.session.user && roles.includes(req.session.user.tipo_usuario)) {
          next();
      } else {
          res.status(403).send('Acceso denegado');
      }
  };
}

// Middleware para verificar el inicio de sesión
function requireLogin(req, res, next) {
  if (!req.session.user) {
      return res.redirect('/login.html');
  }
  next();
}

// Configuración de la sesión
app.use(session({
  secret: 'secretKey',
  resave: false,
  saveUninitialized: false,
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Ruta protegida (Página principal después de iniciar sesión)
app.get('/', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Servir archivos estáticos (HTML)
app.use(express.static(path.join(__dirname, 'public')));

// Ruta para la página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Configuración de la base de datos
const connection = mysql.createConnection({
    host: process.env.DB_HOST,       // Host desde .env
    user: process.env.DB_USER,       // Usuario desde .env
    password: process.env.DB_PASSWORD,   // Contraseña desde .env
    database: process.env.DB_NAME,    // Nombre de la base de datos desde .env
 });

  
  connection.connect(err => {
    if (err) {
      console.error('Error conectando a MySQL:', err);
      return;
    }
    console.log('Conexión exitosa a MySQL');
  });

//registro
  app.post('/registro', async (req, res) => {
    const { username, password, codigo_acceso } = req.body;

    const query = 'SELECT tipo_usuario FROM codigos_acceso WHERE codigo = ?';
    connection.query(query, [codigo_acceso], (err, results) => {
        if (err || results.length === 0) {
            return res.send('Código de acceso inválido');
        }

        const tipo_usuario = results[0].tipo_usuario;
        const hashedPassword = bcrypt.hashSync(password, 10);

        const insertUser = 'INSERT INTO usuarios (nombre_usuario, password, tipo_usuario) VALUES (?, ?, ?)';
        connection.query(insertUser, [username, hashedPassword, tipo_usuario], (err) => {
            if (err) return res.send('Error al registrar usuario');
            res.redirect('/login.html');
        });
    });
});

// Iniciar sesión
app.post('/login', (req, res) => {
  const { nombre_usuario, password } = req.body;

  const query = 'SELECT * FROM usuarios WHERE nombre_usuario = ?';
  connection.query(query, [nombre_usuario], (err, results) => {
      if (err) {
          return res.send('Error al obtener el usuario');
      }

      if (results.length === 0) {
          return res.send('Usuario no encontrado');
      }

      const user = results[0];

      const isPasswordValid = bcrypt.compareSync(password, user.password);
      if (!isPasswordValid) {
          return res.send('Contraseña incorrecta');
      }
  
      // Almacenar la información del usuario en la sesión
      req.session.user = {
          id: user.id,
          nombre_usuario: user.nombre_usuario,
          tipo_usuario: user.tipo_usuario
      }; 

      res.redirect('/');
  });
});


//ruta para enviar el menú de manera dinámica
app.get('/menu', (req, res) => {
  const menuItems = [
    { nombre: 'Inicio', url: '/index.html' },
    { nombre: 'Equipos', url: '/equipos.html' },
    { nombre: 'Usuarios', url: '/usuarios.html' },
    { nombre: 'Búsqueda', url: '/busqueda.html' }
  ];
  res.json(menuItems);
}); 

//Ruta para manejar la busqueda
app.get('/buscar', (req, res) => {
  const query = req.query.query;
  const sql = `SELECT nombre_usuario, tipo_usuario FROM usuarios WHERE nombre_usuario LIKE ?`;
  connection.query(sql, [`%${query}%`], (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

//Ruta para manejar la carga a excel 
const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('excelFile'), (req, res) => {
const filePath = req.file.path;
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

data.forEach(row => {
  const { protesis, precio } = row;
  const sql = `INSERT INTO protesis (tipo_protesis, precio) VALUES (?, ?)`;
  connection.query(sql, [protesis, precio], err => {
    if (err) throw err;
  });
});

res.send('<link rel="stylesheet" href="/styles.css"><h1>Archivo cargado y datos guardados</h1><a href="/protesis.html">Volver</a>');
});

//Ruta para la descarga de archivos
app.get('/download', (req, res) => {
  const sql = `SELECT * FROM protesis`;
  connection.query(sql, (err, results) => {
    if (err) throw err;

    const worksheet = xlsx.utils.json_to_sheet(results);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Protesis');

    const filePath = path.join(__dirname, 'uploads', 'protesis.xlsx');
    xlsx.writeFile(workbook, filePath);
    res.download(filePath, 'protesis.xlsx');
  });
});

const fs = require('fs');
const PDFDocument = require('pdfkit')
app.get('/downloadpdf', requireLogin, requireRole('Ingeniero','Medico'), (req, res) => {
  const sql = `SELECT * FROM protesis`;
  connection.query(sql, (err, results) => {
    if (err) {
      console.error("Error al consultar la base de datos:", err);
      return res.status(500).send('Error al obtener los datos.');
    }
 
    // Crear el documento PDF
    const doc = new PDFDocument({ autoFirstPage: false }); // Desactivar la creación automática de página
    const filePath = path.join(__dirname, 'uploads', 'rend_protesis.pdf');

    // Crear el archivo PDF en el sistema de archivos
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Agregar una página al documento
    doc.addPage();

    // Título
    doc.fontSize(16).text('Protesis ingresadas', { align: 'center' }).moveDown();

    // Subtítulo
    doc.fontSize(12).text('Protesis ingresadas en el sistema', { align: 'center' }).moveDown(2);

    // Cabecera de la tabla
    doc.fontSize(10).text('Protesis 2024', { align: 'left' }).moveDown();

    // Establecer el formato para las filas de la tabla
    results.forEach((protesis, index) => {
      // Cada fila con los datos de las áreas
      doc.text( `ID: ${protesis.id}, Tipo de protesis: ${protesis.tipo_protesis}, Precio: ${protesis.precio}`, { align: 'left' }).moveDown();
    });

    // Finalizar el documento
    doc.end();

    // Cuando el archivo se haya generado, permitir la descarga
    stream.on('finish', () => {
      res.download(filePath, 'rend_protesis.pdf', (err) => {
        if (err) {
          console.error('Error al descargar el archivo:', err);
          res.status(500).send('Error al descargar el archivo.');
        } else {
          // Eliminar el archivo temporal después de la descarga
          fs.unlinkSync(filePath);
        }
      });
    });
  });
});


// Ruta para obtener el tipo de usuario actual
app.get('/tipo-usuario', requireLogin, (req, res) => {
  res.json({ tipo_usuario: req.session.user.tipo_usuario });
});

app.get('/buscar-pacientes', requireLogin, requireRole('Medico'), (req, res) => {
  // Ruta para buscar pacientes según filtros
  const { name_search, age_search } = req.query;
  let query = 'SELECT * FROM pacientes WHERE 1=1';

  if (name_search) {
    query += ` AND nombre LIKE '%${name_search}%'`;
  }
  if (age_search) {
    query += ` AND edad = ${age_search}`;
  }

  connection.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Resultados de Búsqueda</title>
      </head>
      <body>
        <h1>Resultados de Búsqueda</h1>
        <table>
          <thead>
            <tr>
              <th>ID Paciente</th>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Protesis</th>
              <th>Fecha de Ingreso</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.id}</td>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.protesis}</td>
          <td>${paciente.fecha_ingreso}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });

});


app.get('/busqueda-protesis', requireLogin, requireRole('Medico'), (req, res) => {
  const { protesis_search } = req.query;
  let query = `SELECT*FROM vista_pacientes_protesis WHERE protesis LIKE  '%${protesis_search}%'`;

  connection.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Pacientes por Protesis</title>
      </head>
      <body>
        <h1>Pacientes con esta protesis</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Protesis</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.protesis}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

app.post('/insertar-protesis', requireLogin, requireRole('Ingeniero'), (req, res) => {
  // Ruta para insertar protesis
  const { protesis, precio } = req.body;
  const query = 'INSERT INTO protesis (tipo_protesis,precio) VALUES (?, ?)';

  connection.query(query, [protesis, precio], (err, result) => {
   if (err) {
    return res.send('<link rel="stylesheet" href="/styles.css">Error al insertar el médico.');
   }
   res.send(`<link rel="stylesheet" href="/styles.css">La protesis de ${protesis} ha sido guardada exitosamente. <button onclick="window.location.href='/'">Volver</button>`);
 });
});

  // Ruta para guardar datos en la base de datos
app.post('/submit-data', requireLogin, requireRole('Medico'), (req, res) => {
    const { name, age, protesis_id, fecha} = req.body;
  
    const query = 'INSERT INTO pacientes (nombre, edad, protesis_id, fecha_ingreso) VALUES (?, ?, ?, ?);';
    connection.query(query, [name, age, protesis_id, fecha], (err, result) => {
      if (err) {
        return res.send('<link rel="stylesheet" href="/styles.css">Error al guardar los datos en la base de datos.');
      }
      res.send(`<link rel="stylesheet" href="/styles.css">Paciente ${name} guardado en la base de datos. <button onclick="window.location.href='/'">Volver</button>`);
    });
  });


// Ruta para que solo ingeniero pueda ver todos los usuarios
app.get('/ver-usuarios', requireLogin, requireRole('Ingeniero'), (req, res) => {
  const query = 'SELECT * FROM usuarios';
  connection.query(query, (err, results) => {
      if (err) return res.send('<link rel="stylesheet" href="/styles.css">Error al obtener usuarios');
      let html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <h1Usuarios</h1>
        <link rel="stylesheet" href="/styles.css">
      
        </head>
      <body>
       
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Contraseña</th>
              <th>Tipo de usuario </th>
            </tr>
          </thead>
          <tbody>
    `;

    // Agrega las filas de la tabla dinámicamente
    results.forEach(usuarios => {
      html += `
        <tr>
          <td>${usuarios.nombre_usuario}</td>
          <td>${usuarios.password}</td>
          <td>${usuarios.tipo_usuario}</td>
        </tr>
      `;
    });

    // Finaliza el HTML
    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    // Envía el HTML generado como respuesta
    res.send(html);

  });
});


app.get('/conteo', requireLogin, requireRole('Ingeniero','Medico','Paciente'), (req, res) => {
  const query = 'SELECT protesis.tipo_protesis, COUNT(pacientes.id) AS num_pacientes FROM pacientes JOIN protesis ON pacientes.protesis_id = protesis.id GROUP BY protesis.tipo_protesis';
  connection.query(query, (err, results) => {
      if (err) return res.send('<link rel="stylesheet" href="/styles.css">Error al obtener usuarios');
      let html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <h1>Conteo</h1>
        <link rel="stylesheet" href="/styles.css">
      
        </head>
      <body>
       
        <table>
          <thead>
            <tr>
              <th>Protesis</th>
              <th>Numero de pacientes</th>
            </tr>
          </thead>
          <tbody>
    `;

    // Agrega las filas de la tabla dinámicamente
    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.tipo_protesis}</td>
          <td>${paciente.num_pacientes}</td>
        </tr>
      `;
    });

    // Finaliza el HTML
    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    // Envía el HTML generado como respuesta
    res.send(html);

  });
});

// Ruta para que los médicos puedan ver pacientes
app.get('/pacientes', requireLogin, requireRole('Medico'), (req, res) => {
  connection.query('SELECT * FROM vista_pacientes_protesis', (err, results) => {
    if (err) {
      return res.send('<link rel="stylesheet" href="/styles.css">Error al obtener los datos.');
    }
    
    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Pacientes</title>
      </head>
      <body>
        <h1>Pacientes Registrados</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Protesis</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.protesis}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});



app.get('/promedio', requireLogin, requireRole('Ingeniero','Medico','Paciente'), (req, res) => {
  connection.query('SELECT AVG(precio) AS precio_promedio FROM protesis;', (err, results) => {
    if (err) {
      return res.send('<link rel="stylesheet" href="/styles.css">Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Promedio</title>
      </head>
      <body>
        <h1>Promedio financiero de Protesis</h1>
        <table>
          <thead>
            <tr>
              <th>Promedio financiero</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(protesis => {
      html += `
        <tr>
          <td>${protesis.precio_promedio}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});


app.get('/protesis', requireLogin, requireRole('Ingeniero','Medico','Paciente'), (req, res) => {
  connection.query('SELECT * FROM protesis', (err, results) => {
    if (err) {
      return res.send('<link rel="stylesheet" href="/styles.css">Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Protesis</title>
      </head>
      <body>
        <h1>Protesis Registradas</h1>
        <table>
          <thead>
            <tr>
              <th>Protesis</th>
              <th>Precio</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(protesis => {
      html += `
        <tr>
          <td>${protesis.tipo_protesis}</td>
          <td>${protesis.precio}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

app.get('/ver-mis-datos', requireLogin, requireRole('Paciente'), (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('<link rel="stylesheet" href="/styles.css">Usuario no autenticado');
  }

  // Obtener los datos del usuario de la sesión
  const { nombre_usuario, tipo_usuario } = req.session.user;

  // HTML que muestra los datos del usuario en una tabla
  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Mis Datos</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <div class="container">
        <h2>Mis Datos</h2>
        <table class="styled-table">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Información</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Nombre de Usuario</td>
              <td>${nombre_usuario}</td>
            </tr>
            <tr>
              <td>Tipo de Usuario</td>
              <td>${tipo_usuario}</td>
            </tr>
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </div>
    </body>
    </html>
  `;

  res.send(html);
});




// Ruta para cargar el formulario de edición de pacientes
app.get('/editar-pacientes', requireLogin, requireRole('Medico'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editar-pacientes.html'));
});

// Ruta para actualizar los datos de un paciente
app.post('/editar-pacientes', requireLogin, requireRole('Medico'), (req, res) => {
  const { id, name, age, protesis_id, fecha} = req.body;
  const query = 'UPDATE pacientes SET nombre = ?, edad = ?, protesis_id = ?, fecha_ingreso = ? WHERE id = ?';
  connection.query(query, [name, age, protesis_id, fecha, id], (err, result) => {
    if (err) return res.send('<link rel="stylesheet" href="/styles.css">Error al actualizar los datos del paciente.');
    res.send(`<link rel="stylesheet" href="/styles.css">Paciente ${name} actualizado correctamente.<button onclick="window.location.href='/'">Volver</button>`);
  });
});

// Ruta para obtener un paciente por su ID (para el formulario de edición)
app.get('/obtener-paciente/:id', requireLogin, requireRole('Medico'), (req, res) => {
  const { id } = req.params;
  const query = 'SELECT * FROM pacientes WHERE id = ?';
  connection.query(query, [id], (err, results) => {
    if (err) return res.status(500).send('<link rel="stylesheet" href="/styles.css">Error al obtener el paciente');
    if (results.length === 0) return res.status(404).send('<link rel="stylesheet" href="/styles.css">Paciente no encontrado');
    res.json(results[0]);
  });
});





// Ruta para eliminar un paciente
app.delete('/eliminar-paciente/:id', requireLogin, requireRole('Medico'), (req, res) => {
  const { id } = req.params;  // Obtener el ID del paciente desde los parámetros de la URL
  
  // Realizar la consulta SQL para eliminar el paciente por su ID
  const query = 'DELETE FROM pacientes WHERE id = ?';
  connection.query(query, [id], (err, result) => {
    if (err) return res.status(500).send('<link rel="stylesheet" href="/styles.css">Error al eliminar el paciente');
    if (result.affectedRows === 0) return res.status(404).send('<link rel="stylesheet" href="/styles.css">Paciente no encontrado');
    res.send(`<link rel="stylesheet" href="/styles.css">Paciente con ID ${id} eliminado exitosamente.<button onclick="window.location.href='/'">Volver</button>`);
  });
});


// Cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// Iniciar el servidor
// Configuración de puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en funcionamiento en el puerto ${PORT}, Servidor corriendo en http://localhost:3000`));

