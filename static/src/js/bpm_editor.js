/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onMounted, onWillUnmount, useRef } from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

/**
 * Widget personnalisé pour l'éditeur graphique de workflow BPM
 * Utilise SVG pour dessiner les nœuds et les liens
 */
export class BpmEditorWidget extends Component {
    static template = "custom_bpm.BpmEditorWidget";
    static props = {
        ...standardFieldProps,
    };

    setup() {
        this.canvasRef = useRef("canvas");
        this.state = useState({
            nodes: [],
            edges: [],
            selectedNode: null,
            selectedEdge: null,
            isDragging: false,
            dragOffset: { x: 0, y: 0 },
            isConnecting: false,
            connectionStart: null,
        });

        // Charge la définition JSON existante
        this.loadDefinition();

        onMounted(() => {
            this.initializeCanvas();
        });

        onWillUnmount(() => {
            this.cleanup();
        });
    }

    /**
     * Charge la définition JSON depuis le champ
     */
    loadDefinition() {
        const value = this.props.record.data[this.props.name];
        if (value && typeof value === 'string') {
            try {
                const definition = JSON.parse(value);
                this.state.nodes = definition.nodes || [];
                this.state.edges = definition.edges || [];
            } catch (e) {
                console.error("Erreur lors du chargement de la définition JSON:", e);
                this.state.nodes = [];
                this.state.edges = [];
            }
        } else {
            this.state.nodes = [];
            this.state.edges = [];
        }
    }

    /**
     * Sauvegarde la définition JSON dans le champ
     */
    saveDefinition() {
        const definition = {
            nodes: this.state.nodes,
            edges: this.state.edges,
        };
        const jsonString = JSON.stringify(definition);
        this.props.record.update({ [this.props.name]: jsonString });
    }

    /**
     * Initialise le canvas SVG
     */
    initializeCanvas() {
        const canvas = this.canvasRef.el;
        if (!canvas) return;

        // Ajoute les gestionnaires d'événements
        canvas.addEventListener("click", this.onCanvasClick.bind(this));
        canvas.addEventListener("mousemove", this.onCanvasMouseMove.bind(this));
        canvas.addEventListener("mouseup", this.onCanvasMouseUp.bind(this));

        // Redessine le canvas
        this.redraw();
    }

    /**
     * Nettoie les événements
     */
    cleanup() {
        const canvas = this.canvasRef.el;
        if (canvas) {
            canvas.removeEventListener("click", this.onCanvasClick);
            canvas.removeEventListener("mousemove", this.onCanvasMouseMove);
            canvas.removeEventListener("mouseup", this.onCanvasMouseUp);
        }
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
        
        const rect = this.canvasRef.el.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // Vérifie si on clique sur un nœud
        const clickedNode = this.findNodeAt(x, y);
        if (clickedNode) {
            this.selectNode(clickedNode);
            return;
        }

        // Si on est en mode connexion, crée une connexion
        if (this.state.isConnecting && this.state.connectionStart) {
            const targetNode = this.findNodeAt(x, y);
            if (targetNode && targetNode.id !== this.state.connectionStart.id) {
                this.createEdge(this.state.connectionStart.id, targetNode.id);
            }
            this.state.isConnecting = false;
            this.state.connectionStart = null;
            return;
        }

        // Sinon, désélectionne
        this.state.selectedNode = null;
        this.state.selectedEdge = null;
    }

    /**
     * Gère le mouvement de la souris sur le canvas
     */
    onCanvasMouseMove(event) {
        if (!this.canvasRef.el) return;
        
        if (this.state.isDragging && this.state.selectedNode) {
            const rect = this.canvasRef.el.getBoundingClientRect();
            const x = event.clientX - rect.left - this.state.dragOffset.x;
            const y = event.clientY - rect.top - this.state.dragOffset.y;
            
            this.state.selectedNode.x = Math.max(0, x);
            this.state.selectedNode.y = Math.max(0, y);
            this.saveDefinition();
        }
    }

    /**
     * Gère le relâchement de la souris
     */
    onCanvasMouseUp(event) {
        if (this.state.isDragging) {
            this.state.isDragging = false;
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
        this.state.selectedNode = node;
        this.state.selectedEdge = null;
    }

    /**
     * Démarre le glisser-déposer d'un nœud
     */
    startDrag(event, node) {
        event.stopPropagation();
        const rect = this.canvasRef.el.getBoundingClientRect();
        this.state.dragOffset = {
            x: event.clientX - rect.left - node.x,
            y: event.clientY - rect.top - node.y,
        };
        this.state.isDragging = true;
        this.selectNode(node);
    }

    /**
     * Ajoute un nouveau nœud
     */
    addNode(type = "task") {
        const newNode = {
            id: this.generateId(),
            type: type,
            name: this.getNodeTypeLabel(type),
            x: 100 + Math.random() * 200,
            y: 100 + Math.random() * 200,
        };
        this.state.nodes.push(newNode);
        this.saveDefinition();
    }

    /**
     * Supprime le nœud sélectionné
     */
    deleteSelectedNode() {
        if (this.state.selectedNode) {
            const nodeId = this.state.selectedNode.id;
            // Supprime les edges connectés
            this.state.edges = this.state.edges.filter(
                edge => edge.source !== nodeId && edge.target !== nodeId
            );
            // Supprime le nœud
            this.state.nodes = this.state.nodes.filter(node => node.id !== nodeId);
            this.state.selectedNode = null;
            this.saveDefinition();
        }
    }

    /**
     * Démarre la création d'une connexion
     */
    startConnection(node) {
        this.state.isConnecting = true;
        this.state.connectionStart = node;
    }

    /**
     * Crée une transition entre deux nœuds
     */
    createEdge(sourceId, targetId) {
        // Vérifie si l'edge existe déjà
        const exists = this.state.edges.some(
            edge => edge.source === sourceId && edge.target === targetId
        );
        if (exists) return;

        const newEdge = {
            id: this.generateId(),
            source: sourceId,
            target: targetId,
        };
        this.state.edges.push(newEdge);
        this.saveDefinition();
    }

    /**
     * Supprime l'edge sélectionné
     */
    deleteSelectedEdge() {
        if (this.state.selectedEdge) {
            this.state.edges = this.state.edges.filter(
                edge => edge.id !== this.state.selectedEdge.id
            );
            this.state.selectedEdge = null;
            this.saveDefinition();
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

