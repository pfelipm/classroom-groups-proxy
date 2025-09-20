/**
 * @OnlyCurrentDoc
 *
 * El fichero principal del backend para la Web App "Classroom Groups Proxy".
 * Contiene la lógica para servir la interfaz, interactuar con las APIs de
 * Classroom y Admin SDK, y registrar la actividad en la hoja de cálculo.
 */

// Hoja de cálculo activa como base de datos y registro.
const ss = SpreadsheetApp.getActiveSpreadsheet();
const logSheet = ss.getSheetByName('Registro de Operaciones') || ss.insertSheet('Registro de Operaciones');
const groupsSheet = ss.getSheetByName('Grupos Creados') || ss.insertSheet('Grupos Creados');

/**
 * Sirve la aplicación web al acceder a la URL del script.
 * @returns {HtmlOutput} La página web principal.
 */
function doGet(e) {
  const html = HtmlService.createTemplateFromFile('index').evaluate();
  html.setTitle('Classroom Groups Proxy');
  html.addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return html;
}

/**
 * Incluye el contenido de otros ficheros (CSS, JS) en la plantilla HTML.
 * @param {string} filename El nombre del fichero a incluir.
 * @returns {string} El contenido del fichero.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Obtiene la información del usuario que está visitando la webapp.
 * @returns {object} Un objeto con el email y el dominio del usuario.
 */
function obtenerInfoUsuario() {
  const email = Session.getActiveUser().getEmail();
  const domain = email.split('@')[1];
  return { email: email, domain: domain };
}

/**
 * Obtiene la lista de cursos de Classroom en los que el usuario activo es profesor,
 * ordenada alfabéticamente.
 * @returns {Array} Una lista de objetos, cada uno representando un curso.
 */
function obtenerCursos() {
  try {
    const locale = ss.getSpreadsheetLocale().split('_')[0];
    const courses = [];
    let pageToken;
    do {
      const response = Classroom.Courses.list({
        teacherId: Session.getActiveUser().getEmail(),
        courseStates: ['ACTIVE'],
        pageToken: pageToken,
        pageSize: 100
      });
      if (response.courses) {
        response.courses.forEach(course => {
          let ownerName = 'N/A';
          let ownerEmail = 'N/A';
          try {
             const owner = AdminDirectory.Users.get(course.ownerId);
             ownerName = owner.name.fullName;
             ownerEmail = owner.primaryEmail;
          } catch (e) {
            console.warn(`No se pudo obtener el propietario para el curso ${course.id}: ${e.message}`);
          }
          
          courses.push({
            id: course.id,
            name: course.name,
            section: course.section || '',
            description: course.description || '',
            ownerName: ownerName,
            ownerEmail: ownerEmail,
            creationTime: new Date(course.creationTime).toLocaleString(),
            enrollmentCode: course.enrollmentCode,
            alternateLink: course.alternateLink,
            teacherGroupEmail: course.teacherGroupEmail || 'N/A',
            courseGroupEmail: course.courseGroupEmail || 'N/A',
            driveFolderUrl: course.teacherFolder ? course.teacherFolder.alternateLink : 'N/A'
          });
        });
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
    
    courses.sort((a, b) => a.name.localeCompare(b.name, locale));
    
    _logOperation('Obtener Cursos', 'Éxito', `Se encontraron ${courses.length} cursos.`);
    return courses;
  } catch (error) {
    _logOperation('Obtener Cursos', 'Error', error.message);
    throw new Error(JSON.stringify({ key: 'courseFetchError' }));
  }
}

/**
 * Obtiene los profesores y alumnos de un curso específico, ordenados alfabéticamente.
 * @param {string} idCurso El ID del curso de Classroom.
 * @returns {object} Un objeto con dos arrays: 'teachers' y 'students'.
 */
function obtenerUsuarios(idCurso) {
  try {
    const locale = ss.getSpreadsheetLocale().split('_')[0];
    const teachers = Classroom.Courses.Teachers.list(idCurso, {pageSize: 1000}).teachers || [];
    const students = Classroom.Courses.Students.list(idCurso, {pageSize: 1000}).students || [];
    
    const sortByName = (a, b) => a.profile.name.fullName.localeCompare(b.profile.name.fullName, locale);
    teachers.sort(sortByName);
    students.sort(sortByName);
    
    const mapUser = user => ({
      id: user.userId,
      name: user.profile.name.fullName,
      email: user.profile.emailAddress
    });
    
    _logOperation('Obtener Usuarios', 'Éxito', `Curso: ${idCurso}. Profesorado: ${teachers.length}, Alumnado: ${students.length}.`);
    return {
      teachers: teachers.map(mapUser),
      students: students.map(mapUser)
    };
  } catch (error) {
    _logOperation('Obtener Usuarios', 'Error', `Curso: ${idCurso}. ${error.message}`);
    throw new Error(JSON.stringify({ key: 'userFetchError' }));
  }
}

/**
 * Crea un grupo de Google y añade los miembros seleccionados.
 * Se ejecuta con los permisos del administrador que desplegó la app.
 * @param {object} datosGrupo Objeto con la información para crear el grupo.
 * @returns {object} Un objeto con el resultado de la operación.
 */
function crearGrupoDeClase(datosGrupo) {
  const { courseId, courseName, members, ownerEmail, domain, makeVisible, makeTeachersManagers, allTeacherEmails } = datosGrupo;
  
  const cleanName = courseName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const truncatedCleanName = cleanName.slice(0, 30);
  const groupId = `cgp-${truncatedCleanName}-${courseId}`;
  const groupEmail = `${groupId}@${domain}`;
  const groupName = `CGP - ${courseName}`;

  const memberSet = new Set(members);
  memberSet.add(ownerEmail);
  const finalMembers = Array.from(memberSet);

  try {
    // 1. Crear el grupo de directorio
    const newGroup = AdminDirectory.Groups.insert({
      email: groupEmail,
      name: groupName,
      description: `Grupo para la clase de Classroom '${courseName}' (ID: ${courseId}). Creado por ${ownerEmail}.`
    });

    // --- INICIO DE LA MODIFICACIÓN: Lógica de Binary Exponential Backoff ---
    let intentos = 0;
    let grupoVerificado = false;
    const MAX_INTENTOS = 5;

    // Bucle para verificar que el grupo existe, con un máximo de 5 intentos.
    while (intentos < MAX_INTENTOS && !grupoVerificado) {
      try {
        // Se intenta obtener el grupo para confirmar que se ha propagado.
        AdminDirectory.Groups.get(newGroup.email);
        grupoVerificado = true; // Si no hay error, el grupo existe y podemos continuar.
      } catch (e) {
        // Si hay error, el grupo aún no está disponible.
        intentos++;
        if (intentos < MAX_INTENTOS) {
          // Se calcula el tiempo de espera: 2^intentos segundos + hasta 1 segundo aleatorio (jitter).
          const tiempoEspera = Math.pow(2, intentos) * 1000 + Math.floor(Math.random() * 1000);
          console.log(`Intento ${intentos} de verificación fallido. Reintentando en ${tiempoEspera} ms...`);
          Utilities.sleep(tiempoEspera);
        }
      }
    }

    // Si tras los 5 intentos el grupo no se ha verificado, lanzar un error.
    if (!grupoVerificado) {
      throw new Error('No se pudo confirmar la creación del grupo tras varios intentos.');
    }
    
    // --- FIN DE LA MODIFICACIÓN ---


    // 2. Añadir miembros (solo si el grupo ha sido verificado)
    finalMembers.forEach(memberEmail => {
      let role = 'MEMBER'; // Rol por defecto
      if (memberEmail === ownerEmail) {
        role = 'OWNER';
      } else if (makeTeachersManagers && allTeacherEmails.includes(memberEmail)) {
        role = 'MANAGER';
      }
      
      AdminDirectory.Members.insert({
        email: memberEmail,
        role: role
      }, newGroup.id);
    });

    // 3. Establecer los ajustes del grupo.
    const groupSettings = {
      whoCanJoin: 'INVITED_CAN_JOIN',
      isArchived: true, // Si true se guardan los mensajes enviados
      allowWebPosting: true,
      whoCanDiscoverGroup: 'ALL_IN_DOMAIN_CAN_DISCOVER', // Si "ALL_MEMBERS_CAN_DISCOVER" a menudo error "WHO_CAN_VIEW_MEMBERSHIP_CANNOT_BE_BROADER_THAN_WHO_CAN_SEE_GROUP"
      whoCanPostMessage: 'ALL_MANAGERS_CAN_POST', // Añadir check para ALL_MEMBERS_CAN_POST
      whoCanViewGroup: 'ALL_MEMBERS_CAN_VIEW',
      whoCanViewMembership: 'ALL_MEMBERS_CAN_VIEW', // El ajuste "Quién puede ver las direcciones de email de los miembros" no parece estar expuesto, por defecto "ALL_IN_DOMAIN (con estos ajustes)
      whoCanContactOwner: 'ALL_MEMBERS_CAN_CONTACT',
      archiveOnly: false,
    };
    AdminGroupsSettings.Groups.patch(groupSettings, newGroup.email);

    _logOperation('Crear Grupo', 'Éxito', `Grupo ${groupEmail} creado. Visible en Grupos: ${makeVisible}.`);
    _logGroupCreation(newGroup.id, groupName, groupEmail, courseId, courseName, ownerEmail, finalMembers.length);
    
    return { success: true, message: `Grupo ${groupEmail} creado con éxito.`, groupEmail: groupEmail };

  } catch (error) {
    console.error(`Error original capturado en crearGrupoDeClase: ${error.stack}`);
    _logOperation('Crear Grupo', 'Error', `Clase: ${courseName}. ${error.message}`);
    
    const errorMessage = error.message || '';

    if (errorMessage.includes('Entity already exists.')) {
       throw new Error(JSON.stringify({
         key: 'groupExistsError',
         params: { groupEmail: groupEmail }
       }));
    }
    
    if (errorMessage.includes('Resource Not Found')) {
      if (error.stack.includes('Groups.insert')) {
         throw new Error(JSON.stringify({ key: 'groupInsertPermissionError' }));
      } else {
         throw new Error(JSON.stringify({ key: 'memberNotFoundError' }));
      }
    }

    // El error lanzado por el bucle de reintento será capturado aquí y devuelto al frontend.
    throw new Error(JSON.stringify({ key: 'groupCreateError' }));
  }
}

/**
 * Genera y devuelve el contenido CSV de la lista de cursos.
 * @returns {string} El contenido en formato CSV.
 */
function exportarCursosCsv() {
  const courses = obtenerCursos();
  if (courses.length === 0) return '';

  const headers = Object.keys(courses[0]);
  const csvRows = [headers.join(',')];

  courses.forEach(course => {
    const values = headers.map(header => `"${course[header].toString().replace(/"/g, '""')}"`);
    csvRows.push(values.join(','));
  });
  _logOperation('Exportar Cursos', 'Éxito', `Se exportaron ${courses.length} cursos.`);
  return csvRows.join('\n');
}

/**
 * Genera y devuelve el contenido CSV de los usuarios de una clase.
 * @param {string} idCurso El ID del curso.
 * @returns {string} El contenido en formato CSV.
 */
function exportarUsuariosCsv(idCurso) {
  const { teachers, students } = obtenerUsuarios(idCurso);
  if (teachers.length === 0 && students.length === 0) return '';
  
  const headers = ['role', 'id', 'name', 'email'];
  const csvRows = [headers.join(',')];

  const addUserToCsv = (user, role) => {
    const values = [role, user.id, `"${user.name}"`, user.email];
    csvRows.push(values.join(','));
  };

  teachers.forEach(t => addUserToCsv(t, 'Teacher'));
  students.forEach(s => addUserToCsv(s, 'Student'));
  
  _logOperation('Exportar Usuarios', 'Éxito', `Curso ${idCurso}. Exportados ${teachers.length} miembros del profesorado y ${students.length} del alumnado.`);
  return csvRows.join('\n');
}


// --- FUNCIONES DE REGISTRO ---

/**
 * Escribe una nueva fila en la hoja 'Registro de Operaciones'.
 * @private
 */
function _logOperation(action, status, details) {
  logSheet.appendRow([new Date(), Session.getActiveUser().getEmail(), action, status, details]);
}

/**
 * Escribe una nueva fila en la hoja 'Grupos Creados'.
 * @private
 */
function _logGroupCreation(groupId, groupName, groupEmail, courseId, courseName, owner, memberCount) {
  if (groupsSheet.getLastRow() === 0) {
    groupsSheet.appendRow(['Fecha de Creación', 'ID del Grupo', 'Nombre del Grupo', 'Email del Grupo', 'ID de la Clase', 'Nombre de la Clase', 'Propietario', 'Nº Miembros']);
  }
  groupsSheet.appendRow([new Date(), groupId, groupName, groupEmail, courseId, courseName, owner, memberCount]);
}

