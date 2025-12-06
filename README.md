<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CV - Haitham Elashhab</title>
    <style>
        /* ESTILOS GENERALES Y DISEÑO */
        :root {
            --primary-color: #2c3e50; /* Azul oscuro elegante */
            --accent-color: #3498db;  /* Azul brillante para destacar */
            --text-color: #333;
            --bg-color: #f9f9f9;
            --white: #ffffff;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: var(--text-color);
            background-color: var(--bg-color);
            margin: 0;
            padding: 0;
        }

        .container {
            max-width: 900px;
            margin: 40px auto;
            background: var(--white);
            padding: 40px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            border-radius: 8px;
        }

        /* ENCABEZADO */
        header {
            text-align: center;
            border-bottom: 2px solid var(--bg-color);
            padding-bottom: 30px;
            margin-bottom: 30px;
        }

        h1 {
            color: var(--primary-color);
            margin-bottom: 5px;
            font-size: 2.5em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .subtitle {
            font-size: 1.2em;
            color: var(--accent-color);
            font-weight: bold;
            margin-bottom: 15px;
        }

        .contact-info {
            font-size: 0.95em;
            color: #666;
        }

        .contact-info span {
            margin: 0 10px;
        }

        /* SECCIONES */
        section {
            margin-bottom: 40px;
        }

        h2 {
            color: var(--primary-color);
            border-left: 5px solid var(--accent-color);
            padding-left: 15px;
            font-size: 1.5em;
            margin-bottom: 20px;
        }

        /* EXPERIENCIA */
        .job {
            margin-bottom: 25px;
        }

        .job-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 10px;
        }

        .job-title {
            font-weight: bold;
            font-size: 1.1em;
        }

        .company {
            color: #666;
            font-style: italic;
        }

        .date {
            color: var(--accent-color);
            font-weight: bold;
            font-size: 0.9em;
        }

        ul {
            list-style-type: none; /* Quitamos los puntos estándar */
            padding-left: 0;
        }

        li {
            position: relative;
            padding-left: 20px;
            margin-bottom: 10px;
        }

        /* Puntos personalizados */
        li::before {
            content: "•";
            color: var(--accent-color);
            font-weight: bold;
            position: absolute;
            left: 0;
        }

        /* IDIOMAS - TU PUESTO FUERTE */
        .skills-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
        }

        .skill-card {
            background: var(--bg-color);
            padding: 15px;
            border-radius: 5px;
            text-align: center;
            border: 1px solid #eee;
        }

        .skill-card strong {
            display: block;
            color: var(--primary-color);
            margin-bottom: 5px;
        }

        /* BOTÓN DE ACCIÓN */
        .cta-button {
            display: inline-block;
            background-color: var(--primary-color);
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 25px;
            font-weight: bold;
            transition: background 0.3s;
            margin-top: 20px;
        }

        .cta-button:hover {
            background-color: var(--accent-color);
        }

        /* RESPONSIVE PARA MÓVILES */
        @media (max-width: 600px) {
            .container {
                margin: 0;
                padding: 20px;
                border-radius: 0;
            }
            .job-header {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>

    <div class="container">
        <header>
            <h1>Haitham Elashhab</h1>
            <div class="subtitle">Especialista en Servicio al Cliente | Perfil Políglota (5 Idiomas)</div>
            <div class="contact-info">
                <span>📍 [Ciudad, País]</span>
                <span>📞 621066981</span>
                <span>✉️ haithamelashhab@gmail.com</span>
            </div>
            <a href="mailto:haithamelashhab@gmail.com" class="cta-button">Contrátame</a>
        </header>

        <section>
            <h2>Perfil Profesional</h2>
            <p>Profesional de hostelería orientado a resultados con sólida experiencia en entornos de ritmo acelerado y café de especialidad. Experto en elevar la satisfacción del cliente y la rentabilidad del servicio mediante atención personalizada en 5 idiomas (Español, Inglés, Ruso, Neerlandés, Árabe). Capaz de gestionar altos volúmenes de pedidos manteniendo estándares de calidad premium.</p>
        </section>

        <section>
            <h2>Ventaja Competitiva: Idiomas</h2>
            <div class="skills-grid">
                <div class="skill-card">
                    <strong>Español</strong> Nativo / Bilingüe
                </div>
                <div class="skill-card">
                    <strong>Árabe</strong> Nativo / Bilingüe
                </div>
                <div class="skill-card">
                    <strong>Inglés</strong> Avanzado (C1/C2)
                </div>
                <div class="skill-card">
                    <strong>Ruso</strong> Avanzado
                </div>
                <div class="skill-card">
                    <strong>Neerlandés</strong> Avanzado
                </div>
            </div>
        </section>

        <section>
            <h2>Experiencia Profesional</h2>
            
            <div class="job">
                <div class="job-header">
                    <div>
                        <span class="job-title">Camarero de Sala y Barra (Especialidad Café)</span>
                        <br>
                        <span class="company">Cafetería Moderna - Diversos Establecimientos</span>
                    </div>
                    <span class="date">[20XX] – Actualidad</span>
                </div>
                <ul>
                    <li><strong>Gestión de Volumen:</strong> Mantuve un índice de satisfacción superior al 95% gestionando un promedio de <strong>[40]</strong> mesas diarias en hora punta, optimizando el uso del TPV.</li>
                    <li><strong>Impacto Multilingüe:</strong> Aumenté la fidelización de clientes internacionales personalizando la experiencia en 5 idiomas, convirtiéndome en referente para turistas.</li>
                    <li><strong>Ventas (Upselling):</strong> Incrementé el ticket medio por cliente en un <strong>[15%]</strong> mediante sugerencias estratégicas de productos premium y maridajes.</li>
                    <li><strong>Excelencia Operativa:</strong> Garanticé el 100% de cumplimiento en auditorías de higiene y "Visual Merchandising".</li>
                    <li><strong>Resolución de Conflictos:</strong> Transformé quejas en oportunidades de fidelización mediante soluciones rápidas y diplomacia intercultural.</li>
                </ul>
            </div>
        </section>

        <section>
            <h2>Habilidades Técnicas</h2>
            <div class="skills-grid">
                <div class="skill-card"><strong>Sistemas TPV & Reservas</strong></div>
                <div class="skill-card"><strong>Barista Skills</strong></div>
                <div class="skill-card"><strong>Gestión de Alérgenos</strong></div>
                <div class="skill-card"><strong>Protocolo de Servicio</strong></div>
            </div>
        </section>

        <footer style="text-align: center; font-size: 0.8em; color: #888; margin-top: 50px;">
            <p>© 2024 Haitham Elashhab - Perfil Profesional</p>
        </footer>
    </div>

</body>
</html>
