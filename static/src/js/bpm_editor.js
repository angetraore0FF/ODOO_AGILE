/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onMounted, onWillUnmount, useEffect, useRef } from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

/**
 * Widget personnalisé pour l'éditeur graphique de workflow BPM
 * Utilise SVG pour dessiner les nœuds et les liens
 */
export class BpmEditorWidget extends Component {
    static template = "ODOO_AGILE.BpmEditorWidget";
    static props = {
        ...standardFieldProps,
    };

    setup() {
        this.canvasRef = useRef("canvas");
        this.state = useState({
            nodes: [],
            edges: [],
            selectedNodeIndex: null,
            selectedEdge: null,
            isDragging: false,
            dragOffset: { x: 0, y: 0 },
            isConnecting: false,
            connectionStartIndex: null,
            isLoading: true,
            // Pan (déplacement du canvas)
            isPanning: false,
            panOffset: { x: 0, y: 0 },
            panStart: { x: 0, y: 0 },
            // Zoom
            zoom: 1.0,
        });
        
        // Système de détection du double-clic
        this.lastClickTime = 0;
        this.lastClickedNode = null;
        this.clickTimer = null;
        
        // Getter pour selectedNode basé sur l'index
        Object.defineProperty(this.state, 'selectedNode', {
            get: () => this.state.selectedNodeIndex !== null ? this.state.nodes[this.state.selectedNodeIndex] : null
        });
        Object.defineProperty(this.state, 'connectionStart', {
            get: () => this.state.connectionStartIndex !== null ? this.state.nodes[this.state.connectionStartIndex] : null
        });

        // DRAW.IO STYLE: Créer les bound methods ICI, pas dans initializeCanvas
        this.handleMouseMove = this.onMouseMove.bind(this);
        this.handleMouseUp = this.onMouseUp.bind(this);

        onMounted(async () => {
            // Charge la définition depuis la base de données
            await this.loadDefinition();
            this.state.isLoading = false;
            this.initializeCanvas();
        });

        // Surveillance automatique des changements de nœuds
        useEffect(
            () => {
                // Se déclenche quand les nœuds changent (ajout/suppression depuis l'onglet Nœuds)
                console.log('🔄 Détection de changement dans les nœuds, rechargement...');
                this.loadDefinition();
            },
            () => [this.props.record.data.noeud_ids?.length, JSON.stringify(this.props.record.data.noeud_ids)]
        );

        onWillUnmount(() => {
            this.cleanup();
        });
    }

    /**
     * Charge la définition depuis les enregistrements bpm.node et bpm.edge
     */
    async loadDefinition() {
        const processId = this.props.record.resId || this.props.record.data.id;
        if (!processId) {
            console.warn('❌ Pas de processId disponible');
            this.state.nodes = [];
            this.state.edges = [];
            return;
        }
        console.log('✅ Chargement pour processId:', processId);

        try {
            // Charge les nœuds depuis bpm.node
            const nodeRecords = await this.env.services.orm.searchRead(
                'bpm.node',
                [['process_id', '=', processId]],
                ['id', 'node_id', 'name', 'node_type', 'position_x', 'position_y']
            );

            // Transforme les enregistrements en format du widget
            this.state.nodes = nodeRecords.map(node => ({
                id: node.node_id,
                recordId: node.id,  // ID de l'enregistrement bpm.node
                name: node.name,
                type: node.node_type,
                x: node.position_x,
                y: node.position_y,
            }));

            // Charge les edges depuis bpm.edge
            const edgeRecords = await this.env.services.orm.searchRead(
                'bpm.edge',
                [['process_id', '=', processId]],
                ['id', 'edge_id', 'source_node_id', 'target_node_id', 'name', 'condition', 'sequence']
            );

            // Transforme les edges - il faut mapper les IDs des nœuds
            this.state.edges = edgeRecords.map(edge => {
                // Trouve les node_id correspondants
                const sourceNode = nodeRecords.find(n => n.id === edge.source_node_id[0]);
                const targetNode = nodeRecords.find(n => n.id === edge.target_node_id[0]);
                
                return {
                    id: edge.edge_id,
                    recordId: edge.id,  // ID de l'enregistrement bpm.edge
                    source: sourceNode ? sourceNode.node_id : null,
                    target: targetNode ? targetNode.node_id : null,
                    name: edge.name || '',
                    condition: edge.condition || '',
                    sequence: edge.sequence || 10,
                };
            }).filter(edge => edge.source && edge.target);  // Filtre les edges invalides

        } catch (e) {
            console.error("Erreur lors du chargement depuis la base:", e);
            this.state.nodes = [];
            this.state.edges = [];
        }
    }

    /**
     * Sauvegarde les nœuds et edges dans la base de données
     */
    async saveDefinition() {
        const processId = this.props.record.resId || this.props.record.data.id;
        if (!processId) {
            console.warn("❌ Impossible de sauvegarder: pas de processId");
            return;
        }
        console.log('💾 Sauvegarde pour processId:', processId);

        try {
            // 1. Synchronise les nœuds
            for (const node of this.state.nodes) {
                const nodeData = {
                    name: node.name,
                    node_type: node.type,
                    position_x: node.x,
                    position_y: node.y,
                    process_id: processId,
                    node_id: node.id,
                };

                if (node.recordId) {
                    // Mise à jour d'un nœud existant
                    await this.env.services.orm.write('bpm.node', [node.recordId], nodeData);
                } else {
                    // Création d'un nouveau nœud
                    const newId = await this.env.services.orm.create('bpm.node', [nodeData]);
                    node.recordId = newId;
                }
            }

            // 2. Récupère les node_ids actuels pour mapper les edges
            const nodeRecords = await this.env.services.orm.searchRead(
                'bpm.node',
                [['process_id', '=', processId]],
                ['id', 'node_id']
            );
            const nodeIdMap = {};
            nodeRecords.forEach(n => {
                nodeIdMap[n.node_id] = n.id;
            });

            // 3. Synchronise les edges
            for (const edge of this.state.edges) {
                const sourceRecordId = nodeIdMap[edge.source];
                const targetRecordId = nodeIdMap[edge.target];

                if (!sourceRecordId || !targetRecordId) {
                    console.warn("Edge invalide, nœuds introuvables:", edge);
                    continue;
                }

                const edgeData = {
                    process_id: processId,
                    source_node_id: sourceRecordId,
                    target_node_id: targetRecordId,
                    edge_id: edge.id,
                    name: edge.name || `Transition ${edge.source} -> ${edge.target}`,
                    condition: edge.condition || false,
                    sequence: edge.sequence || 10,
                };

                if (edge.recordId) {
                    // Mise à jour d'un edge existant
                    await this.env.services.orm.write('bpm.edge', [edge.recordId], edgeData);
                } else {
                    // Création d'un nouveau edge
                    const newId = await this.env.services.orm.create('bpm.edge', [edgeData]);
                    edge.recordId = newId;
                }
            }

            // 4. Supprime les nœuds et edges qui n'existent plus dans le state
            const currentNodeIds = this.state.nodes.map(n => n.recordId).filter(id => id);
            const currentEdgeIds = this.state.edges.map(e => e.recordId).filter(id => id);

            const allNodeRecords = await this.env.services.orm.searchRead(
                'bpm.node',
                [['process_id', '=', processId]],
                ['id']
            );
            const nodesToDelete = allNodeRecords
                .map(n => n.id)
                .filter(id => !currentNodeIds.includes(id));
            if (nodesToDelete.length > 0) {
                await this.env.services.orm.unlink('bpm.node', nodesToDelete);
            }

            const allEdgeRecords = await this.env.services.orm.searchRead(
                'bpm.edge',
                [['process_id', '=', processId]],
                ['id']
            );
            const edgesToDelete = allEdgeRecords
                .map(e => e.id)
                .filter(id => !currentEdgeIds.includes(id));
            if (edgesToDelete.length > 0) {
                await this.env.services.orm.unlink('bpm.edge', edgesToDelete);
            }

            console.log("Définition sauvegardée avec succès");
        } catch (e) {
            console.error("Erreur lors de la sauvegarde:", e);
        }
    }

    /**
     * Initialise le canvas SVG
     */
    initializeCanvas() {
        const canvas = this.canvasRef.el;
        if (!canvas) return;

        // DRAW.IO STYLE: Événements statiques uniquement sur le canvas
        canvas.addEventListener("click", this.onCanvasClick.bind(this));
        canvas.addEventListener("mousedown", this.onCanvasMouseDown.bind(this));
        canvas.addEventListener("wheel", this.onCanvasWheel.bind(this), { passive: false });

        // Redessine le canvas
        this.redraw();
    }

    /**
     * Nettoie les événements
     */
    cleanup() {
        const canvas = this.canvasRef.el;
        if (canvas) {
            canvas.removeEventListener("click", this.boundOnCanvasClick);
            canvas.removeEventListener("mousedown", this.boundOnCanvasMouseDown);
            canvas.removeEventListener("mousemove", this.boundOnCanvasMouseMove);
            canvas.removeEventListener("mouseup", this.boundOnCanvasMouseUp);
            canvas.removeEventListener("wheel", this.boundOnCanvasWheel);
        }
        console.log('✅ Canvas nettoyé');
    }

    /**
     * Redessine tout le canvas
     */
    redraw() {
        // Cette méthode sera appelée automatiquement par OWL lors du rendu
    }

    /**
     * Gère le clic sur le canvas
     */
    onCanvasClick(event) {
        if (!this.canvasRef.el) return;
        
        // Ignore le clic si on était en train de faire du pan
        if (event.button === 1 || event.shiftKey) return;

        const rect = this.canvasRef.el.getBoundingClientRect();
        const x = (event.clientX - rect.left - this.state.panOffset.x) / this.state.zoom;
        const y = (event.clientY - rect.top - this.state.panOffset.y) / this.state.zoom;

        // Trouve le nœud cliqué
        const clickedNode = this.findNodeAt(x, y);

        // Si on est en mode connexion
        if (this.state.isConnecting && this.state.connectionStart) {
            if (clickedNode && clickedNode.id !== this.state.connectionStart.id) {
                // Crée la connexion entre le nœud de départ et le nœud cliqué
                this.createEdge(this.state.connectionStart.id, clickedNode.id);
            }
            // Désactive le mode connexion
            this.state.isConnecting = false;
            this.state.connectionStartIndex = null;
            return;
        }

        // Sinon, gère la sélection normale
        if (clickedNode) {
            this.selectNode(clickedNode);
        } else {
            // Clic sur le canvas vide : désélectionne
            this.state.selectedNodeIndex = null;
            this.state.selectedEdge = null;
        }
    }

    /**
     * Gère le clic initial sur le canvas
     */
    onCanvasMouseDown(event) {
        if (!this.canvasRef.el) return;

        // Seulement le bouton du milieu active le pan (pas Shift)
        if (event.button === 1) {
            event.preventDefault();
            this.state.isPanning = true;
            this.state.panStart = {
                x: event.clientX - this.state.panOffset.x,
                y: event.clientY - this.state.panOffset.y,
            };
            return;
        }

        // Si on est en mode connexion, gère le clic sur un nœud cible
        if (this.state.isConnecting && this.state.connectionStart) {
            const rect = this.canvasRef.el.getBoundingClientRect();
            const x = (event.clientX - rect.left - this.state.panOffset.x) / this.state.zoom;
            const y = (event.clientY - rect.top - this.state.panOffset.y) / this.state.zoom;
            
            const clickedNode = this.findNodeAt(x, y);
            
            if (clickedNode && clickedNode.id !== this.state.connectionStart.id) {
                // Crée la connexion
                this.createEdge(this.state.connectionStart.id, clickedNode.id);
                // Désactive le mode connexion
                this.state.isConnecting = false;
                this.state.connectionStartIndex = null;
                event.preventDefault();
                event.stopPropagation();
            }
        }
    }

    /**
     * DRAW.IO STYLE: Gestionnaire global de mouvement de souris
     */
    onMouseMove(event) {
        // Mode pan
        if (this.state.isPanning) {
            this.state.panOffset.x = event.clientX - this.state.panStart.x;
            this.state.panOffset.y = event.clientY - this.state.panStart.y;
            return;
        }

        // Mode drag de nœud - DRAW.IO STYLE
        if (this.state.isDragging && this.state.selectedNodeIndex !== null) {
            if (!this.canvasRef.el) return;
            
            const rect = this.canvasRef.el.getBoundingClientRect();
            const mouseX = (event.clientX - rect.left - this.state.panOffset.x) / this.state.zoom;
            const mouseY = (event.clientY - rect.top - this.state.panOffset.y) / this.state.zoom;
            
            // Nouvelle position
            const newX = Math.max(0, Math.round(mouseX - this.state.dragOffset.x));
            const newY = Math.max(0, Math.round(mouseY - this.state.dragOffset.y));
            
            // Modifie directement dans le tableau
            this.state.nodes[this.state.selectedNodeIndex].x = newX;
            this.state.nodes[this.state.selectedNodeIndex].y = newY;
        }
    }

    /**
     * Gère le zoom avec la molette
     */
    onCanvasWheel(event) {
        if (!this.canvasRef.el) return;
        event.preventDefault();

        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.2, Math.min(3.0, this.state.zoom * delta));
        
        // Calcule le point focal pour zoomer vers la position de la souris
        const rect = this.canvasRef.el.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Ajuste le pan offset pour zoomer vers la souris
        this.state.panOffset.x = mouseX - (mouseX - this.state.panOffset.x) * (newZoom / this.state.zoom);
        this.state.panOffset.y = mouseY - (mouseY - this.state.panOffset.y) * (newZoom / this.state.zoom);
        
        this.state.zoom = newZoom;
    }

    /**
     * DRAW.IO STYLE: Gestionnaire global de relâchement de souris
     */
    onMouseUp(event) {
        if (this.state.isDragging) {
            this.state.isDragging = false;
            
            // Retirer les événements du document
            document.removeEventListener("mousemove", this.handleMouseMove);
            document.removeEventListener("mouseup", this.handleMouseUp);
            
            // Sauvegarde la position après le drag (sans notifyFieldChange pour éviter surcharge)
            console.log('✅ Drag terminé - sauvegarde de la position');
            this.saveDefinition();
        }
        if (this.state.isPanning) {
            this.state.isPanning = false;
        }
    }

    /**
     * Trouve un nœud à la position donnée
     */
    findNodeAt(x, y) {
        const nodeSize = 80;
        return this.state.nodes.find(node => {
            return x >= node.x && x <= node.x + nodeSize &&
                   y >= node.y && y <= node.y + nodeSize;
        });
    }

    /**
     * Sélectionne un nœud
     */
    selectNode(node) {
        this.state.selectedNodeIndex = this.state.nodes.findIndex(n => n.id === node.id);
        this.state.selectedEdge = null;
        console.log('✅ Nœud sélectionné, index:', this.state.selectedNodeIndex);
    }

    /**
     * Édite le nom d'un nœud (double-clic)
     */
    async editNodeName(node) {
        console.log('🔍 Node à éditer:', node);
        const newName = prompt('Nouveau nom :', node.name);
        if (newName && newName.trim() !== '' && newName !== node.name) {
            try {
                console.log('📝 Mise à jour du nom - recordId:', node.recordId, 'nouveau nom:', newName.trim());
                
                if (!node.recordId) {
                    console.error('❌ Pas de recordId pour ce nœud:', node);
                    if (this.env.services.notification) {
                        this.env.services.notification.add(
                            'Erreur: nœud invalide',
                            { type: 'danger' }
                        );
                    }
                    return;
                }
                
                // Met à jour en base de données
                const result = await this.env.services.orm.write('bpm.node', [node.recordId], {
                    name: newName.trim()
                });
                
                console.log('✅ Résultat de l\'écriture:', result);
                
                // Recharge tout depuis la base pour avoir les données à jour
                await this.loadDefinition();
                
                // Notifie le changement et recharge le record pour l'onglet Nœuds
                this.notifyFieldChange();
                await this.props.record.load();
                
                console.log('✅ Nom du nœud mis à jour:', newName);
                
                if (this.env.services.notification) {
                    this.env.services.notification.add(
                        `Nom modifié : "${newName}"`,
                        { type: 'success' }
                    );
                }
            } catch (error) {
                console.error('❌ Erreur lors de la mise à jour du nom:', error);
                if (this.env.services.notification) {
                    this.env.services.notification.add(
                        `Erreur: ${error.message}`,
                        { type: 'danger' }
                    );
                }
            }
        }
    }

    /**
     * Démarre le glisser-déposer d'un nœud
     */
    startDrag(event, node) {
        console.log('🎯 startDrag appelé pour:', node.name, 'button:', event.button, 'shiftKey:', event.shiftKey);
        
        // Ne démarre pas le drag si c'est le bouton du milieu
        if (event.button === 1) {
            console.log('❌ Drag annulé: bouton milieu');
            return;
        }
        
        // Détection du double-clic (deux clics sur le même nœud en moins de 300ms)
        const now = Date.now();
        if (this.lastClickedNode === node.id && (now - this.lastClickTime) < 300) {
            console.log('💡 Double-clic détecté sur:', node.name);
            event.preventDefault();
            event.stopPropagation();
            this.editNodeName(node);
            this.lastClickTime = 0;
            this.lastClickedNode = null;
            return;
        }
        this.lastClickTime = now;
        this.lastClickedNode = node.id;
        
        // Si on est en mode connexion, créer l'edge et sortir
        if (this.state.isConnecting) {
            console.log('🔗 Mode connexion: création edge');
            if (this.state.connectionStart && this.state.connectionStart.id !== node.id) {
                this.createEdge(this.state.connectionStart.id, node.id);
            }
            this.state.isConnecting = false;
            this.state.connectionStartIndex = null;
            return;
        }
        
        // Empêche les comportements par défaut
        event.stopPropagation();
        event.preventDefault();

        const rect = this.canvasRef.el.getBoundingClientRect();
        const mouseX = (event.clientX - rect.left - this.state.panOffset.x) / this.state.zoom;
        const mouseY = (event.clientY - rect.top - this.state.panOffset.y) / this.state.zoom;
        
        this.state.dragOffset = {
            x: mouseX - node.x,
            y: mouseY - node.y,
        };
        this.state.isDragging = true;
        this.selectNode(node);
        
        // DRAW.IO STYLE: Attacher les événements au document
        document.addEventListener("mousemove", this.handleMouseMove);
        document.addEventListener("mouseup", this.handleMouseUp);
        console.log('✅ Drag démarré, isDragging =', this.state.isDragging, 'dragOffset:', this.state.dragOffset);
    }

    /**
     * Ajoute un nouveau nœud
     */
    /**
     * Ajoute un nouveau nœud au workflow et le crée en base de données
     */
    async addNode(type = "task") {
        console.log('🎯 addNode appelé avec type:', type);
        
        const processId = this.props.record.resId || this.props.record.data.id;
        if (!processId) {
            console.error("❌ Impossible d'ajouter un nœud: pas de processId");
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    "Veuillez d'abord enregistrer le processus",
                    { type: 'warning' }
                );
            }
            return;
        }

        // Génère un ID unique pour le nœud
        const nodeId = this.generateId();
        
        // Position aléatoire dans le canvas
        const x = 100 + Math.random() * 300;
        const y = 100 + Math.random() * 300;
        
        // Demande le nom du nœud à l'utilisateur
        const typeLabels = {
            'start': 'Début',
            'task': 'Tâche',
            'gateway': 'Décision',
            'end': 'Fin'
        };
        const defaultName = typeLabels[type] || 'Nœud';
        const nodeName = prompt(`Nom du ${defaultName.toLowerCase()} :`, defaultName);
        
        // Si l'utilisateur annule, ne pas créer le nœud
        if (!nodeName || nodeName.trim() === '') {
            console.log('❌ Création annulée par l\'utilisateur');
            return;
        }

        try {
            console.log('💾 Création du nœud en base:', { processId, nodeId, nodeName, type });
            
            // Crée le nœud directement en base de données
            const recordId = await this.env.services.orm.create('bpm.node', [{
                name: nodeName,
                node_type: type,
                position_x: x,
                position_y: y,
                process_id: processId,
                node_id: nodeId,
                sequence: (this.state.nodes.length + 1) * 10,
            }]);

            console.log('✅ Nœud créé avec recordId:', recordId);

            // Ajoute le nœud au state local
            const newNode = {
                id: nodeId,
                type: type,
                name: nodeName,
                x: x,
                y: y,
                recordId: Array.isArray(recordId) ? recordId[0] : recordId,
            };
            
            this.state.nodes.push(newNode);
            console.log('✅ Nœud ajouté au state, total:', this.state.nodes.length);
            
            // Notifie Odoo que le champ a changé (pour marquer le record comme modifié)
            this.notifyFieldChange();
            
            // Recharge le record pour rafraîchir l'onglet Nœuds
            await this.props.record.load();
            console.log('🔄 Record rechargé - onglet Nœuds mis à jour');
            
            // Notification de succès
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    `Nœud "${nodeName}" créé`,
                    { type: 'success' }
                );
            }
        } catch (error) {
            console.error("❌ Erreur lors de la création du nœud:", error);
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    `Erreur: ${error.message || 'Impossible de créer le nœud'}`,
                    { type: 'danger' }
                );
            }
        }
    }

    /**
     * Supprime le nœud sélectionné
     */
    async deleteSelectedNode() {
        const selectedNode = this.state.selectedNode;
        if (selectedNode) {
            const nodeId = selectedNode.id;
            const recordId = selectedNode.recordId;
            
            try {
                // 1. Supprime les edges connectés du state
                this.state.edges = this.state.edges.filter(
                    edge => edge.source !== nodeId && edge.target !== nodeId
                );
                
                // 2. Supprime le nœud du state
                this.state.nodes = this.state.nodes.filter(node => node.id !== nodeId);
                this.state.selectedNodeIndex = null;
                
                // 3. Supprime de la base de données si le nœud a un recordId
                if (recordId) {
                    console.log('🗑️ Suppression du nœud en base, recordId:', recordId);
                    await this.env.services.orm.unlink('bpm.node', [recordId]);
                    console.log('✅ Nœud supprimé de la base');
                }
                
                // 4. Notifie Odoo que le champ a changé
                this.notifyFieldChange();
                
                // 5. Recharge le record pour rafraîchir l'onglet Nœuds
                await this.props.record.load();
                console.log('🔄 Record rechargé - onglet Nœuds mis à jour');
                
                // 6. Notification succès
                if (this.env.services.notification) {
                    this.env.services.notification.add(
                        'Nœud supprimé',
                        { type: 'success' }
                    );
                }
            } catch (error) {
                console.error('❌ Erreur lors de la suppression du nœud:', error);
                if (this.env.services.notification) {
                    this.env.services.notification.add(
                        `Erreur: ${error.message || 'Impossible de supprimer le nœud'}`,
                        { type: 'danger' }
                    );
                }
            }
        }
    }

    /**
     * Démarre la création d'une connexion
     */
    startConnection(node) {
        this.state.isConnecting = true;
        this.state.connectionStartIndex = this.state.nodes.findIndex(n => n.id === node.id);
        console.log('Mode connexion activé. Cliquez sur un autre nœud pour créer la connexion.');
        
        // Affiche un message visuel à l'utilisateur
        if (this.env.services.notification) {
            this.env.services.notification.add(
                'Cliquez sur un nœud cible pour créer la connexion',
                { type: 'info' }
            );
        }
    }

    /**
     * Crée une transition entre deux nœuds
     */
    async createEdge(sourceId, targetId) {
        // Vérifie si l'edge existe déjà
        const exists = this.state.edges.some(
            edge => edge.source === sourceId && edge.target === targetId
        );
        if (exists) return;

        const processId = this.props.record.resId || this.props.record.data.id;
        if (!processId) {
            console.error('❌ Impossible de créer la connexion: pas de processId');
            return;
        }

        try {
            // 1. Trouve les recordIds des nœuds source et target
            const sourceNode = this.state.nodes.find(n => n.id === sourceId);
            const targetNode = this.state.nodes.find(n => n.id === targetId);
            
            if (!sourceNode || !targetNode || !sourceNode.recordId || !targetNode.recordId) {
                console.error('❌ Nœuds source ou target introuvables');
                return;
            }

            // 2. Crée l'edge en base de données
            const edgeId = this.generateId();
            console.log('🔗 Création edge en base:', sourceId, '->', targetId);
            
            const recordId = await this.env.services.orm.create('bpm.edge', [{
                process_id: processId,
                source_node_id: sourceNode.recordId,
                target_node_id: targetNode.recordId,
                edge_id: edgeId,
                name: `Transition ${sourceNode.name} -> ${targetNode.name}`,
                condition: false,
                sequence: 10,
            }]);

            // 3. Ajoute au state local
            const newEdge = {
                id: edgeId,
                recordId: Array.isArray(recordId) ? recordId[0] : recordId,
                source: sourceId,
                target: targetId,
                name: '',
                condition: '',
                sequence: 10,
            };
            this.state.edges.push(newEdge);
            console.log('✅ Connexion créée:', sourceId, '->', targetId);
            
            // 4. Notifie Odoo que le champ a changé
            this.notifyFieldChange();
            
            // 5. Notification succès
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    'Connexion créée',
                    { type: 'success' }
                );
            }
        } catch (error) {
            console.error('❌ Erreur lors de la création de la connexion:', error);
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    `Erreur: ${error.message || 'Impossible de créer la connexion'}`,
                    { type: 'danger' }
                );
            }
        }
    }

    /**
     * Supprime l'edge sélectionné
     */
    async deleteSelectedEdge() {
        if (this.state.selectedEdge) {
            const edge = this.state.selectedEdge;
            const recordId = edge.recordId;
            
            try {
                // 1. Supprime du state
                this.state.edges = this.state.edges.filter(
                    e => e.id !== edge.id
                );
                this.state.selectedEdge = null;
                
                // 2. Supprime de la base de données si l'edge a un recordId
                if (recordId) {
                    console.log('🗑️ Suppression edge en base, recordId:', recordId);
                    await this.env.services.orm.unlink('bpm.edge', [recordId]);
                    console.log('✅ Connexion supprimée de la base');
                }
                
                // 3. Notifie Odoo que le champ a changé
                this.notifyFieldChange();
                
                // 4. Notification succès
                if (this.env.services.notification) {
                    this.env.services.notification.add(
                        'Connexion supprimée',
                        { type: 'success' }
                    );
                }
            } catch (error) {
                console.error('❌ Erreur lors de la suppression de la connexion:', error);
                if (this.env.services.notification) {
                    this.env.services.notification.add(
                        `Erreur: ${error.message || 'Impossible de supprimer la connexion'}`,
                        { type: 'danger' }
                    );
                }
            }
        }
    }

    /**
     * Notifie Odoo que le champ a été modifié
     */
    notifyFieldChange() {
        // Crée une représentation JSON de la définition actuelle
        const definition = JSON.stringify({
            nodes: this.state.nodes.map(n => ({
                id: n.id,
                recordId: n.recordId,
                name: n.name,
                type: n.type,
                x: n.x,
                y: n.y
            })),
            edges: this.state.edges.map(e => ({
                id: e.id,
                recordId: e.recordId,
                source: e.source,
                target: e.target,
                name: e.name,
                condition: e.condition,
                sequence: e.sequence
            }))
        });
        
        // Notifie Odoo via props.update
        if (this.props.update) {
            this.props.update(definition);
            console.log('📢 Odoo notifié du changement');
        }
    }

    /**
     * Génère un ID unique
     */
    generateId() {
        return "node_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Retourne le label d'un type de nœud
     */
    getNodeTypeLabel(type) {
        const labels = {
            start: "Début",
            task: "Tâche",
            gateway: "Décision",
            end: "Fin",
        };
        return labels[type] || type;
    }

    /**
     * Retourne la couleur d'un type de nœud
     */
    getNodeColor(type) {
        const colors = {
            start: "#4CAF50",
            task: "#2196F3",
            gateway: "#FF9800",
            end: "#F44336",
        };
        return colors[type] || "#757575";
    }

    /**
     * Calcule les coordonnées d'une flèche entre deux nœuds
     */
    getEdgePath(sourceNode, targetNode) {
        const nodeSize = 80;
        const sourceX = sourceNode.x + nodeSize / 2;
        const sourceY = sourceNode.y + nodeSize / 2;
        const targetX = targetNode.x + nodeSize / 2;
        const targetY = targetNode.y + nodeSize / 2;

        // Ligne simple entre les deux points
        return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    }

    /**
     * Trouve les nœuds source et cible d'un edge
     */
    getEdgeNodes(edge) {
        const sourceNode = this.state.nodes.find(n => n.id === edge.source);
        const targetNode = this.state.nodes.find(n => n.id === edge.target);
        return { sourceNode, targetNode };
    }
}

// Enregistre le widget dans le registre des champs
registry.category("fields").add("bpm_editor", {
    component: BpmEditorWidget,
    supportedTypes: ["text"],
});

